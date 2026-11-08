import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { Terminal } from "#core/ports.ts";
import { jsonSchema, parseOrThrow } from "#core/validation.ts";
import { isLaunchOf, launchCommand } from "./launch-command.ts";

export type ZellijExecutor = (zellijArguments: string[]) => string;

export interface ZellijParams {
  execute?: ZellijExecutor;
}

const optionsSchema = z.object({ zellij: z.string().min(1) });
const handleSchema = z.object({ session: z.string(), paneId: z.string(), launchId: z.string() });

type ZellijHandle = z.output<typeof handleSchema>;

export function zellij({ execute = executeZellij }: ZellijParams = {}): Terminal<typeof optionsSchema, typeof handleSchema> {
  return {
    options: optionsSchema,
    handle: handleSchema,

    isAvailable() {
      return listSessions(execute).some((session) => !session.isExited);
    },

    open({ title, cwd, command, options: { zellij: sessionName } }) {
      requireLiveSession(execute, sessionName);

      const tabId = findAgentTabId(execute, sessionName, title);
      const { launchId, argv } = launchCommand(command);
      const paneId = parseOrThrow(paneIdSchema, execute(["--session", sessionName, "run", "--tab-id", tabId, "--cwd", cwd, "--name", title, "--", ...argv]));

      stackTab(execute, sessionName, tabId, paneId);

      return { session: sessionName, paneId, launchId };
    },

    isLive(handle: ZellijHandle) {
      const pane = findLaunchedPane(execute, handle);
      return pane !== null && !pane.exited;
    },

    deliver({ session, paneId }: ZellijHandle, text) {
      execute(["--session", session, "action", "paste", "--pane-id", paneId, text]);
      execute(["--session", session, "action", "send-keys", "--pane-id", paneId, "Enter"]);
    },

    close(handle: ZellijHandle) {
      if (findLaunchedPane(execute, handle) !== null) {
        execute(["--session", handle.session, "action", "close-pane", "--pane-id", handle.paneId]);
      }
    },
  };
}

const exitedMarker = "EXITED";
const terminalPanePrefix = "terminal_";

const sessionLineSchema = z
  .string()
  .regex(/^\S+/)
  .transform((line) => ({ name: line.split(" ", 1)[0] ?? "", isExited: line.includes(exitedMarker) }));

const sessionsSchema = z
  .string()
  .transform((output) => output.split("\n").filter(Boolean))
  .pipe(z.array(sessionLineSchema));

const tabsSchema = jsonSchema(z.array(z.looseObject({ tab_id: z.number(), position: z.number(), name: z.string() })));

const panesSchema = jsonSchema(
  z.array(z.looseObject({ id: z.number(), tab_id: z.number(), is_plugin: z.boolean(), exited: z.boolean(), terminal_command: z.string().nullable() })),
);

type ZellijPane = z.output<typeof panesSchema>[number];

const paneIdSchema = z.string().regex(/^terminal_\d+$/, { error: (issue) => `zellij returned an unexpected pane id: ${String(issue.input)}` });

function executeZellij(zellijArguments: string[]): string {
  return execFileSync("zellij", zellijArguments, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function listSessions(execute: ZellijExecutor): z.output<typeof sessionsSchema> {
  let output: string;
  try {
    output = execute(["list-sessions", "--no-formatting"]);
  } catch {
    return [];
  }

  return parseOrThrow(sessionsSchema, output);
}

function isSessionLive(execute: ZellijExecutor, sessionName: string): boolean {
  return listSessions(execute).some((session) => session.name === sessionName && !session.isExited);
}

function requireLiveSession(execute: ZellijExecutor, sessionName: string): void {
  if (!isSessionLive(execute, sessionName)) {
    throw new Error(`zellij session "${sessionName}" is not running; start it from your terminal`);
  }
}

function findAgentTabId(execute: ZellijExecutor, sessionName: string, agentName: string): string {
  const tabs = parseOrThrow(tabsSchema, execute(["--session", sessionName, "action", "list-tabs", "--json"]));
  const [firstTab] = tabs.toSorted((earlier, later) => earlier.position - later.position);
  const agentTab = tabs.find((tab) => tab.name === agentName) ?? firstTab;
  if (!agentTab) {
    throw new Error(`zellij session "${sessionName}" has no tabs`);
  }

  return String(agentTab.tab_id);
}

function stackTab(execute: ZellijExecutor, sessionName: string, tabId: string, newPaneId: string): void {
  const tabPaneIds = listTerminalPanes(execute, sessionName)
    .filter((pane) => String(pane.tab_id) === tabId)
    .map((pane) => toPaneId(pane.id))
    .filter((paneId) => paneId !== newPaneId);
  if (tabPaneIds.length === 0) {
    return;
  }

  execute(["--session", sessionName, "action", "stack-panes", "--", ...tabPaneIds, newPaneId]);
}

function findLaunchedPane(execute: ZellijExecutor, { session, paneId, launchId }: ZellijHandle): ZellijPane | null {
  if (!isSessionLive(execute, session)) {
    return null;
  }

  const panes = listTerminalPanes(execute, session);
  return panes.find((pane) => toPaneId(pane.id) === paneId && isLaunchOf(pane.terminal_command, launchId)) ?? null;
}

function listTerminalPanes(execute: ZellijExecutor, sessionName: string): z.output<typeof panesSchema> {
  const panes = parseOrThrow(panesSchema, execute(["--session", sessionName, "action", "list-panes", "--json", "--all"]));
  return panes.filter((pane) => !pane.is_plugin);
}

function toPaneId(paneNumber: number | string): string {
  return `${terminalPanePrefix}${paneNumber}`;
}
