import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { zellij } from "./zellij.ts";

interface FakeZellijParams {
  sessions?: string;
  panes?: string;
  tabId?: string;
  isListingBroken?: boolean;
}

function fakeZellij({ sessions = "", panes = "[]", tabId = "4", isListingBroken = false }: FakeZellijParams = {}) {
  const calls: string[][] = [];
  const terminal = zellij({
    execute(zellijArguments) {
      calls.push(zellijArguments);

      if (zellijArguments[0] === "list-sessions") {
        if (isListingBroken) {
          throw new Error("No active zellij sessions found.");
        }
        return sessions;
      }

      if (zellijArguments.includes("new-tab")) {
        return tabId;
      }

      if (zellijArguments.includes("list-panes")) {
        return panes;
      }

      return "";
    },
  });
  return { calls, terminal };
}

const openRequest = { title: "digest", cwd: "/work", command: ["node", "cli.ts", "run", "digest"], options: { zellij: "agents" } };
const handle = { session: "agents", paneId: "terminal_5" };
const loginShellScript = `exec "\${SHELL:-/bin/sh}" -lic 'exec "$0" "$@"' "$@"`;

describe("zellij", () => {
  describe("options", () => {
    it("should require a session name and ignore other keys", () => {
      const { terminal } = fakeZellij();

      assert.deepEqual(terminal.options.parse({ zellij: "agents", other: 1 }), { zellij: "agents" });
      assert.equal(terminal.options.safeParse({}).success, false);
      assert.equal(terminal.options.safeParse({ zellij: "" }).success, false);
    });
  });

  describe("isAvailable", () => {
    it("should be true when any session is live", () => {
      const { terminal } = fakeZellij({ sessions: "old [Created 1h ago] (EXITED - attach to resurrect)\nmain [Created 2h ago] (current)" });

      assert.equal(terminal.isAvailable(), true);
    });

    it("should be false when every session has exited", () => {
      const { terminal } = fakeZellij({ sessions: "old [Created 1h ago] (EXITED - attach to resurrect)" });

      assert.equal(terminal.isAvailable(), false);
    });

    it("should be false when zellij reports no sessions", () => {
      const { terminal } = fakeZellij({ isListingBroken: true });

      assert.equal(terminal.isAvailable(), false);
    });
  });

  describe("open", () => {
    it("should open a named tab and run the command in a pane of it through the login shell", () => {
      const { calls, terminal } = fakeZellij({ sessions: "agents [Created 1h ago]" });

      terminal.open(openRequest);

      assert.deepEqual(calls.slice(1), [
        ["--session", "agents", "action", "new-tab", "--name", "digest", "--cwd", "/work", "--close-on-exit", "--", "sleep", "3"],
        ["--session", "agents", "run", "--tab-id", "4", "--cwd", "/work", "--name", "digest", "--close-on-exit", "--", "/bin/sh", "-c", loginShellScript, "cadence", "node", "cli.ts", "run", "digest"],
      ]);
    });

    it("should hand the command its arguments intact through the login shell", () => {
      const { calls, terminal } = fakeZellij({ sessions: "agents [Created 1h ago]" });
      terminal.open({ ...openRequest, command: ["/bin/sh", "-c", 'printf "[%s]" "$@"', "probe", "two words", "it's quoted"] });
      const runCall = calls.at(-1) ?? [];
      const [executable = "", ...commandArguments] = runCall.slice(runCall.indexOf("--") + 1);

      const { stdout } = spawnSync(executable, commandArguments, { encoding: "utf8", env: { PATH: "/usr/bin:/bin", SHELL: "/bin/sh" } });

      assert.equal(stdout, "[two words][it's quoted]");
    });

    it("should refuse to open anything when the session is not running", () => {
      const { calls, terminal } = fakeZellij({ sessions: "main [Created 1h ago]" });

      assert.throws(() => terminal.open(openRequest), /zellij session "agents" is not running; start it from your terminal/);
      assert.equal(calls.length, 1);
    });

    it("should refuse to open anything when the session has exited", () => {
      const { calls, terminal } = fakeZellij({ sessions: "agents [Created 1h ago] (EXITED - attach to resurrect)" });

      assert.throws(() => terminal.open(openRequest), /is not running/);
      assert.equal(calls.length, 1);
    });

    it("should refuse to run anything when zellij returns an unexpected tab id", () => {
      const { calls, terminal } = fakeZellij({ sessions: "agents [Created 1h ago]", tabId: "oops" });

      assert.throws(() => terminal.open(openRequest), /unexpected tab id: oops/);
      assert.equal(calls.some((call) => call.includes("run")), false);
    });
  });

  describe("currentHandle", () => {
    it("should read the session and pane from zellij's environment", () => {
      const { terminal } = fakeZellij();

      assert.deepEqual(terminal.currentHandle({ ZELLIJ_SESSION_NAME: "agents", ZELLIJ_PANE_ID: "5" }), handle);
    });

    it("should be null outside zellij or with a malformed pane id", () => {
      const { terminal } = fakeZellij();

      assert.equal(terminal.currentHandle({}), null);
      assert.equal(terminal.currentHandle({ ZELLIJ_SESSION_NAME: "agents", ZELLIJ_PANE_ID: "five" }), null);
    });
  });

  describe("isLive", () => {
    it("should be true when the pane is listed and running", () => {
      const panes = JSON.stringify([
        { id: 0, is_plugin: true, exited: false, title: "status" },
        { id: 5, is_plugin: false, exited: false, title: "digest" },
      ]);
      const { terminal } = fakeZellij({ sessions: "agents [Created 1h ago]", panes });

      assert.equal(terminal.isLive(handle), true);
    });

    it("should be false when the pane has exited or is missing", () => {
      const exitedPanes = JSON.stringify([{ id: 5, is_plugin: false, exited: true }]);

      assert.equal(fakeZellij({ sessions: "agents [Created 1h ago]", panes: exitedPanes }).terminal.isLive(handle), false);
      assert.equal(fakeZellij({ sessions: "agents [Created 1h ago]", panes: "[]" }).terminal.isLive(handle), false);
    });

    it("should not match a plugin pane with the same number", () => {
      const panes = JSON.stringify([{ id: 5, is_plugin: true, exited: false }]);

      assert.equal(fakeZellij({ sessions: "agents [Created 1h ago]", panes }).terminal.isLive(handle), false);
    });

    it("should be false without listing panes when the session is gone", () => {
      const { calls, terminal } = fakeZellij({ sessions: "main [Created 1h ago]" });

      assert.equal(terminal.isLive(handle), false);
      assert.equal(calls.some((call) => call.includes("list-panes")), false);
    });
  });

  describe("deliver", () => {
    it("should paste the text into the pane and press Enter", () => {
      const { calls, terminal } = fakeZellij();

      terminal.deliver(handle, "Your instructions are in /agents/digest.md.");

      assert.deepEqual(calls, [
        ["--session", "agents", "action", "paste", "--pane-id", "terminal_5", "Your instructions are in /agents/digest.md."],
        ["--session", "agents", "action", "send-keys", "--pane-id", "terminal_5", "Enter"],
      ]);
    });
  });
});
