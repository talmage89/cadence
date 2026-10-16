import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { Terminal } from "#core/ports.ts";
import { jsonSchema, parseOrThrow } from "#core/validation.ts";

export type ZellijExecutor = (zellijArguments: string[]) => string;

export interface ZellijParams {
  execute?: ZellijExecutor;
}

const optionsSchema = z.object({ zellij: z.string().min(1) });
const handleSchema = z.object({ session: z.string(), paneId: z.string() });

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

      const tabId = parseOrThrow(
        tabIdSchema,
        execute(["--session", sessionName, "action", "new-tab", "--name", title, "--cwd", cwd, "--close-on-exit", "--", ...placeholderCommand]),
      );
      execute(["--session", sessionName, "run", "--tab-id", tabId, "--cwd", cwd, "--name", title, "--close-on-exit", "--", ...throughLoginShell(command)]);
    },

    currentHandle(environment) {
      const result = paneEnvironmentSchema.safeParse(environment);
      return result.success ? result.data : null;
    },

    isLive({ session, paneId }: ZellijHandle) {
      if (!isSessionLive(execute, session)) {
        return false;
      }

      const panes = parseOrThrow(panesSchema, execute(["--session", session, "action", "list-panes", "--json", "--all"]));
      return panes.some((pane) => !pane.is_plugin && !pane.exited && toPaneId(pane.id) === paneId);
    },

    deliver({ session, paneId }: ZellijHandle, text) {
      execute(["--session", session, "action", "paste", "--pane-id", paneId, text]);
      execute(["--session", session, "action", "send-keys", "--pane-id", paneId, "Enter"]);
    },
  };
}

const exitedMarker = "EXITED";
const terminalPanePrefix = "terminal_";
const placeholderCommand = ["sleep", "3"];
const loginShellScript = `exec "\${SHELL:-/bin/sh}" -lic 'exec "$0" "$@"' "$@"`;

const sessionLineSchema = z
  .string()
  .regex(/^\S+/)
  .transform((line) => ({ name: line.split(" ", 1)[0] ?? "", isExited: line.includes(exitedMarker) }));

const sessionsSchema = z
  .string()
  .transform((output) => output.split("\n").filter(Boolean))
  .pipe(z.array(sessionLineSchema));

const tabIdSchema = z.string().regex(/^\d+$/, { error: (issue) => `zellij returned an unexpected tab id: ${String(issue.input)}` });

const panesSchema = jsonSchema(z.array(z.looseObject({ id: z.number(), is_plugin: z.boolean(), exited: z.boolean() })));

const paneEnvironmentSchema = z
  .object({ ZELLIJ_SESSION_NAME: z.string().min(1), ZELLIJ_PANE_ID: z.string().regex(/^\d+$/) })
  .transform(({ ZELLIJ_SESSION_NAME, ZELLIJ_PANE_ID }) => ({ session: ZELLIJ_SESSION_NAME, paneId: toPaneId(ZELLIJ_PANE_ID) }));

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

function throughLoginShell(command: string[]): string[] {
  return ["/bin/sh", "-c", loginShellScript, "cadence", ...command];
}

function toPaneId(paneNumber: number | string): string {
  return `${terminalPanePrefix}${paneNumber}`;
}
