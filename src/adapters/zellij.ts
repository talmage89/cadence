import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { Terminal } from "../core/ports.ts";

export type ZellijExecutor = (zellijArguments: string[]) => string;

export interface ZellijSettings {
  execute?: ZellijExecutor;
}

interface ZellijSession {
  name: string;
  isExited: boolean;
}

const options = z.object({ zellij: z.string().min(1) });
const handle = z.object({ session: z.string(), paneId: z.string() });

type ZellijHandle = z.output<typeof handle>;

const placeholderLayout = 'layout {\n  pane command="sleep" close_on_exit=true {\n    args "3"\n  }\n}';

const listedPaneSchema = z.array(
  z.object({ id: z.number(), is_plugin: z.boolean(), exited: z.boolean() }).loose(),
);

function executeZellij(zellijArguments: string[]): string {
  return execFileSync("zellij", zellijArguments, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function zellij({ execute = executeZellij }: ZellijSettings = {}): Terminal<typeof options, typeof handle> {
  function listSessions(): ZellijSession[] {
    try {
      return execute(["list-sessions", "--no-formatting"])
        .split("\n")
        .filter(Boolean)
        .map((line) => ({ name: line.split(" ")[0] ?? "", isExited: line.includes("EXITED") }));
    } catch {
      return [];
    }
  }

  function isSessionLive(sessionName: string): boolean {
    return listSessions().some((session) => session.name === sessionName && !session.isExited);
  }

  function ensureSession(sessionName: string): void {
    const existingSession = listSessions().find((session) => session.name === sessionName);
    if (existingSession && !existingSession.isExited) return;

    if (existingSession) execute(["delete-session", sessionName]);
    execute(["attach", "--create-background", sessionName]);
  }

  return {
    options,
    handle,

    isAvailable() {
      return listSessions().some((session) => !session.isExited);
    },

    open({ title, cwd, command, options: { zellij: sessionName } }) {
      ensureSession(sessionName);

      const tabId = execute(["--session", sessionName, "action", "new-tab", "--name", title, "--layout-string", placeholderLayout]);
      execute(["--session", sessionName, "run", "--tab-id", tabId, "--cwd", cwd, "--name", title, "--close-on-exit", "--", ...command]);
    },

    currentHandle(environment) {
      const session = environment.ZELLIJ_SESSION_NAME;
      const paneNumber = environment.ZELLIJ_PANE_ID;
      if (!session || !paneNumber) return null;
      return { session, paneId: `terminal_${paneNumber}` };
    },

    isLive({ session, paneId }: ZellijHandle) {
      if (!isSessionLive(session)) return false;

      const panes = listedPaneSchema.parse(JSON.parse(execute(["--session", session, "action", "list-panes", "--json", "--all"])));
      return panes.some((pane) => !pane.is_plugin && !pane.exited && `terminal_${pane.id}` === paneId);
    },

    deliver({ session, paneId }: ZellijHandle, text) {
      execute(["--session", session, "action", "paste", "--pane-id", paneId, text]);
      execute(["--session", session, "action", "send-keys", "--pane-id", paneId, "Enter"]);
    },
  };
}
