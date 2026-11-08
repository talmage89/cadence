import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zellij } from "./zellij.ts";

interface FakeZellijParams {
  sessions?: string;
  tabs?: string;
  panes?: string;
  runPaneId?: string;
  isListingBroken?: boolean;
}

const liveAgentsSession = "agents [Created 1h ago]";
const twoTabs = JSON.stringify([
  { tab_id: 4, position: 1, name: "notes" },
  { tab_id: 0, position: 0, name: "main" },
]);

function fakeZellij({ sessions = "", tabs = twoTabs, panes = "[]", runPaneId = "terminal_7", isListingBroken = false }: FakeZellijParams = {}) {
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

      if (zellijArguments.includes("list-tabs")) {
        return tabs;
      }

      if (zellijArguments.includes("list-panes")) {
        return panes;
      }

      if (zellijArguments[2] === "run") {
        return runPaneId;
      }

      return "";
    },
  });
  return { calls, terminal };
}

function findRunCall(calls: string[][]): string[] {
  return calls.find((call) => call[2] === "run") ?? [];
}

function panesJson(...panes: Partial<ZellijPaneFixture>[]): string {
  return JSON.stringify(panes.map((pane) => ({ id: 0, tab_id: 0, is_plugin: false, exited: false, terminal_command: null, ...pane })));
}

interface ZellijPaneFixture {
  id: number;
  tab_id: number;
  is_plugin: boolean;
  exited: boolean;
  terminal_command: string | null;
}

const openRequest = { title: "digest", cwd: "/work", command: ["node", "cli.ts", "run", "digest"], options: { zellij: "agents" } };
const launchId = "0b7f3c52-5d2e-4f8a-9c41-2e6a8d9b1f07";
const handle = { session: "agents", paneId: "terminal_5", launchId };
const launchedCommand = `/usr/bin/env CADENCE_LAUNCH_ID=${launchId} /bin/sh -c exec ... cadence node cli.ts run digest`;
const otherLaunchCommand = "/usr/bin/env CADENCE_LAUNCH_ID=6d1e2f30-8a4b-4c5d-9e6f-7a8b9c0d1e2f /bin/sh -c exec ... cadence node cli.ts run digest";

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
    it("should run the launched command in the session's first tab, leaving the pane after it exits", () => {
      const { calls, terminal } = fakeZellij({ sessions: liveAgentsSession });

      terminal.open(openRequest);
      const runCall = findRunCall(calls);

      assert.deepEqual(runCall.slice(0, 10), ["--session", "agents", "run", "--tab-id", "0", "--cwd", "/work", "--name", "digest", "--"]);
      assert.equal(runCall[10], "/usr/bin/env");
      assert.match(runCall[11] ?? "", /^CADENCE_LAUNCH_ID=[0-9a-f-]{36}$/);
      assert.deepEqual(runCall.slice(-4), ["node", "cli.ts", "run", "digest"]);
      assert.equal(calls.some((call) => call.includes("new-tab")), false);
    });

    it("should prefer a tab named after the agent", () => {
      const tabs = JSON.stringify([
        { tab_id: 0, position: 0, name: "main" },
        { tab_id: 6, position: 1, name: "digest" },
      ]);
      const { calls, terminal } = fakeZellij({ sessions: liveAgentsSession, tabs });

      terminal.open(openRequest);

      assert.equal(findRunCall(calls)[4], "6");
    });

    it("should stack the new pane with the other panes in its tab, finished ones included", () => {
      const panes = panesJson({ id: 0 }, { id: 3, exited: true }, { id: 9, is_plugin: true }, { id: 5, tab_id: 4 }, { id: 7 });
      const { calls, terminal } = fakeZellij({ sessions: liveAgentsSession, panes });

      terminal.open(openRequest);

      assert.deepEqual(calls.at(-1), ["--session", "agents", "action", "stack-panes", "--", "terminal_0", "terminal_3", "terminal_7"]);
    });

    it("should not stack a pane that is alone in its tab", () => {
      const panes = panesJson({ id: 7 });
      const { calls, terminal } = fakeZellij({ sessions: liveAgentsSession, panes });

      terminal.open(openRequest);

      assert.equal(calls.some((call) => call.includes("stack-panes")), false);
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

    it("should report a session with no tabs", () => {
      const { terminal } = fakeZellij({ sessions: liveAgentsSession, tabs: "[]" });

      assert.throws(() => terminal.open(openRequest), /has no tabs/);
    });

    it("should not stack anything when zellij returns an unexpected pane id", () => {
      const { calls, terminal } = fakeZellij({ sessions: liveAgentsSession, runPaneId: "oops" });

      assert.throws(() => terminal.open(openRequest), /unexpected pane id: oops/);
      assert.equal(calls.some((call) => call.includes("stack-panes")), false);
    });
  });

  describe("currentHandle", () => {
    it("should read the session, pane, and launch id from the environment", () => {
      const { terminal } = fakeZellij();

      assert.deepEqual(terminal.currentHandle({ ZELLIJ_SESSION_NAME: "agents", ZELLIJ_PANE_ID: "5", CADENCE_LAUNCH_ID: launchId }), handle);
    });

    it("should be null outside zellij, with a malformed pane id, or outside a launch", () => {
      const { terminal } = fakeZellij();

      assert.equal(terminal.currentHandle({ CADENCE_LAUNCH_ID: launchId }), null);
      assert.equal(terminal.currentHandle({ ZELLIJ_SESSION_NAME: "agents", ZELLIJ_PANE_ID: "five", CADENCE_LAUNCH_ID: launchId }), null);
      assert.equal(terminal.currentHandle({ ZELLIJ_SESSION_NAME: "agents", ZELLIJ_PANE_ID: "5" }), null);
    });
  });

  describe("isLive", () => {
    it("should be true when the launch's pane is listed and running", () => {
      const panes = panesJson({ id: 0, is_plugin: true }, { id: 5, terminal_command: launchedCommand });
      const { terminal } = fakeZellij({ sessions: liveAgentsSession, panes });

      assert.equal(terminal.isLive(handle), true);
    });

    it("should be false when the pane has exited or is missing", () => {
      const exitedPanes = panesJson({ id: 5, exited: true, terminal_command: launchedCommand });

      assert.equal(fakeZellij({ sessions: liveAgentsSession, panes: exitedPanes }).terminal.isLive(handle), false);
      assert.equal(fakeZellij({ sessions: liveAgentsSession, panes: "[]" }).terminal.isLive(handle), false);
    });

    it("should not match a plugin pane with the same number", () => {
      const panes = panesJson({ id: 5, is_plugin: true, terminal_command: launchedCommand });

      assert.equal(fakeZellij({ sessions: liveAgentsSession, panes }).terminal.isLive(handle), false);
    });

    it("should be false when a restarted session has given the pane's number to another pane", () => {
      const reusedByShell = panesJson({ id: 5 });
      const reusedByLaunch = panesJson({ id: 5, terminal_command: otherLaunchCommand });

      assert.equal(fakeZellij({ sessions: liveAgentsSession, panes: reusedByShell }).terminal.isLive(handle), false);
      assert.equal(fakeZellij({ sessions: liveAgentsSession, panes: reusedByLaunch }).terminal.isLive(handle), false);
    });

    it("should be false without listing panes when the session is gone", () => {
      const { calls, terminal } = fakeZellij({ sessions: "main [Created 1h ago]" });

      assert.equal(terminal.isLive(handle), false);
      assert.equal(calls.some((call) => call.includes("list-panes")), false);
    });
  });

  describe("close", () => {
    it("should close the finished session's pane", () => {
      const panes = panesJson({ id: 5, exited: true, terminal_command: launchedCommand });
      const { calls, terminal } = fakeZellij({ sessions: liveAgentsSession, panes });

      terminal.close(handle);

      assert.deepEqual(calls.at(-1), ["--session", "agents", "action", "close-pane", "--pane-id", "terminal_5"]);
    });

    it("should do nothing when the pane or the session is already gone", () => {
      const withoutPane = fakeZellij({ sessions: liveAgentsSession, panes: "[]" });
      const withoutSession = fakeZellij({ sessions: "main [Created 1h ago]" });

      withoutPane.terminal.close(handle);
      withoutSession.terminal.close(handle);

      assert.equal(withoutPane.calls.some((call) => call.includes("close-pane")), false);
      assert.equal(withoutSession.calls.some((call) => call.includes("list-panes")), false);
    });

    it("should leave alone a pane that a restarted session gave the same number", () => {
      // After a restart, the old number can belong to one of your panes or to the run that just opened.
      const yourPane = fakeZellij({ sessions: liveAgentsSession, panes: panesJson({ id: 5 }) });
      const newRunPane = fakeZellij({ sessions: liveAgentsSession, panes: panesJson({ id: 5, terminal_command: otherLaunchCommand }) });

      yourPane.terminal.close(handle);
      newRunPane.terminal.close(handle);

      assert.equal(yourPane.calls.some((call) => call.includes("close-pane")), false);
      assert.equal(newRunPane.calls.some((call) => call.includes("close-pane")), false);
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
