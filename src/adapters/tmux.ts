import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { Terminal } from "#core/ports.ts";
import { parseOrThrow } from "#core/validation.ts";
import { isLaunchOf, launchCommand } from "./launch-command.ts";

export type TmuxExecutor = (tmuxArguments: string[]) => string;

export interface TmuxParams {
  socketName?: string;
  execute?: TmuxExecutor;
}

const optionsSchema = z.object({ tmux: z.string().min(1).optional() });
const handleSchema = z.object({ socket: z.string(), paneId: z.string(), launchId: z.string() });

type TmuxHandle = z.output<typeof handleSchema>;

export function tmux({ socketName, execute = executeTmux }: TmuxParams = {}): Terminal<typeof optionsSchema, typeof handleSchema> {
  const configuredServer = socketName === undefined ? execute : withArguments(execute, ["-L", socketName]);

  return {
    options: optionsSchema,
    handle: handleSchema,

    isAvailable() {
      return listSessions(configuredServer).length > 0;
    },

    open({ title, cwd, command, options: { tmux: sessionName } }) {
      const { launchId, argv } = launchCommand(command);
      const placement: Placement = { agentName: title, cwd, argv };
      const pane =
        sessionName === undefined ? openInOwnSession(configuredServer, placement) : openInNamedSession(configuredServer, sessionName, placement);

      configuredServer(["set-option", "-p", "-t", pane.paneId, "remain-on-exit", "on"]);

      return { ...pane, launchId };
    },

    isLive(handle: TmuxHandle) {
      const pane = findLaunchedPane(serverAt(execute, handle.socket), handle);
      return pane !== null && !pane.isDead;
    },

    deliver({ socket, paneId }: TmuxHandle, text) {
      const server = serverAt(execute, socket);

      server(["copy-mode", "-q", "-t", paneId]);
      server(["set-buffer", "-b", deliveryBuffer, "--", text]);
      server(["paste-buffer", "-p", "-d", "-b", deliveryBuffer, "-t", paneId]);
      server(["send-keys", "-t", paneId, "Enter"]);
    },

    close(handle: TmuxHandle) {
      const server = serverAt(execute, handle.socket);
      if (findLaunchedPane(server, handle) !== null) {
        server(["kill-pane", "-t", handle.paneId]);
      }
    },
  };
}

interface Placement {
  agentName: string;
  cwd: string;
  argv: string[];
}

const sessionTagOption = "@cadence-session";
const windowTagOption = "@cadence-window";
const deliveryBuffer = "cadence-delivery";
const fieldSeparator = "\t";
const paneIdPattern = /^%\d+$/;

const sessionRowsSchema = rowsSchema(
  z.tuple([z.string(), z.string(), z.string()]).transform(([id, name, agentName]) => ({ id, name, agentName })),
);

const windowRowsSchema = rowsSchema(z.tuple([z.string(), z.string()]).transform(([id, agentName]) => ({ id, agentName })));

const paneRowsSchema = rowsSchema(
  z
    .tuple([z.string(), z.stringbool()], z.string())
    .transform(([id, isDead, ...startCommandFields]) => ({ id, isDead, startCommand: startCommandFields.join(fieldSeparator) })),
);

type TmuxPane = z.output<typeof paneRowsSchema>[number];

const createdPaneSchema = z
  .string()
  .transform((output) => output.split(fieldSeparator))
  .pipe(
    z.tuple([z.string().regex(paneIdPattern), z.string().min(1)], {
      error: (issue) => `tmux returned an unexpected pane: ${JSON.stringify(issue.input)}`,
    }),
  )
  .transform(([paneId, socket]) => ({ paneId, socket }));

type CreatedPane = z.output<typeof createdPaneSchema>;

function executeTmux(tmuxArguments: string[]): string {
  const output = execFileSync("tmux", tmuxArguments, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return output.replace(/\n+$/, "");
}

function withArguments(execute: TmuxExecutor, leadingArguments: string[]): TmuxExecutor {
  return (tmuxArguments) => execute([...leadingArguments, ...tmuxArguments]);
}

function listSessions(server: TmuxExecutor): z.output<typeof sessionRowsSchema> {
  const sessionFormat = ["#{session_id}", "#{session_name}", `#{${sessionTagOption}}`].join(fieldSeparator);
  return parseOrThrow(sessionRowsSchema, queryRunningServer(server, ["list-sessions", "-F", sessionFormat]));
}

function openInOwnSession(server: TmuxExecutor, placement: Placement): CreatedPane {
  const { agentName } = placement;
  const sessions = listSessions(server);
  const ownSession = sessions.find((session) => session.agentName === agentName);
  if (ownSession) {
    return openInSession(server, ownSession.id, placement);
  }

  if (sessions.some((session) => session.name === agentName)) {
    throw new Error(`tmux session "${agentName}" was not opened by cadence; rename it, or name another session in the tmux key`);
  }

  const pane = createPane(server, ["new-session", "-d", "-s", agentName, "-n", agentName], placement);
  server(["set-option", "-t", pane.paneId, sessionTagOption, agentName]);
  server(["set-option", "-w", "-t", pane.paneId, windowTagOption, agentName]);

  return pane;
}

function openInNamedSession(server: TmuxExecutor, sessionName: string, placement: Placement): CreatedPane {
  const namedSession = listSessions(server).find((session) => session.name === sessionName);
  if (!namedSession) {
    throw new Error(`tmux session "${sessionName}" is not running; start it from your terminal`);
  }

  return openInSession(server, namedSession.id, placement);
}

function openInSession(server: TmuxExecutor, sessionId: string, placement: Placement): CreatedPane {
  const { agentName } = placement;
  const agentWindowId = findAgentWindowId(server, sessionId, agentName);
  if (agentWindowId !== null) {
    return createPane(server, ["split-window", "-d", "-t", agentWindowId], placement);
  }

  const pane = createPane(server, ["new-window", "-d", "-t", `${sessionId}:`, "-n", agentName], placement);
  server(["set-option", "-w", "-t", pane.paneId, windowTagOption, agentName]);

  return pane;
}

function findAgentWindowId(server: TmuxExecutor, sessionId: string, agentName: string): string | null {
  const windowFormat = ["#{window_id}", `#{${windowTagOption}}`].join(fieldSeparator);
  const windows = parseOrThrow(windowRowsSchema, server(["list-windows", "-t", sessionId, "-F", windowFormat]));

  return windows.find((listedWindow) => listedWindow.agentName === agentName)?.id ?? null;
}

function createPane(server: TmuxExecutor, creationArguments: string[], { cwd, argv }: Placement): CreatedPane {
  const createdPaneFormat = ["#{pane_id}", "#{socket_path}"].join(fieldSeparator);
  return parseOrThrow(createdPaneSchema, server([...creationArguments, "-c", cwd, "-P", "-F", createdPaneFormat, "--", ...argv]));
}

function serverAt(execute: TmuxExecutor, socket: string): TmuxExecutor {
  return withArguments(execute, ["-S", socket]);
}

function findLaunchedPane(server: TmuxExecutor, { paneId, launchId }: TmuxHandle): TmuxPane | null {
  const paneFormat = ["#{pane_id}", "#{pane_dead}", "#{pane_start_command}"].join(fieldSeparator);
  const panes = parseOrThrow(paneRowsSchema, queryRunningServer(server, ["list-panes", "-a", "-F", paneFormat]));

  return panes.find((pane) => pane.id === paneId && isLaunchOf(pane.startCommand, launchId)) ?? null;
}

function queryRunningServer(server: TmuxExecutor, queryArguments: string[]): string {
  try {
    return server(queryArguments);
  } catch {
    return "";
  }
}

function rowsSchema<RowSchema extends z.ZodType<unknown, string[]>>(rowSchema: RowSchema) {
  return z
    .string()
    .transform((output) => output.split("\n").filter(Boolean).map((line) => line.split(fieldSeparator)))
    .pipe(z.array(rowSchema));
}
