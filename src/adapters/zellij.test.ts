import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zellij } from "./zellij.ts";

interface FakeZellij {
  calls: string[][];
  sessions: string;
  panes: string;
  failListing: boolean;
}

function fakeZellij(overrides: Partial<FakeZellij> = {}) {
  const fake: FakeZellij = { calls: [], sessions: "", panes: "[]", failListing: false, ...overrides };
  const terminal = zellij({
    execute(zellijArguments) {
      fake.calls.push(zellijArguments);
      if (zellijArguments[0] === "list-sessions") {
        if (fake.failListing) throw new Error("No active zellij sessions found.");
        return fake.sessions;
      }
      if (zellijArguments.includes("new-tab")) return "4";
      if (zellijArguments.includes("list-panes")) return fake.panes;
      if (zellijArguments.includes("run")) return "terminal_5";
      return "";
    },
  });
  return { fake, terminal };
}

const request = { title: "digest", cwd: "/work", command: ["node", "cli.ts", "run", "digest"], options: { zellij: "agents" } };

describe("zellij options", () => {
  it("requires a session name", () => {
    const { terminal } = fakeZellij();
    assert.deepEqual(terminal.options.parse({ zellij: "agents", other: 1 }), { zellij: "agents" });
    assert.equal(terminal.options.safeParse({}).success, false);
    assert.equal(terminal.options.safeParse({ zellij: "" }).success, false);
  });
});

describe("isAvailable", () => {
  it("is true when any session is live", () => {
    const { terminal } = fakeZellij({ sessions: "old [Created 1h ago] (EXITED - attach to resurrect)\nmain [Created 2h ago] (current)" });
    assert.equal(terminal.isAvailable(), true);
  });

  it("is false when every session has exited", () => {
    const { terminal } = fakeZellij({ sessions: "old [Created 1h ago] (EXITED - attach to resurrect)" });
    assert.equal(terminal.isAvailable(), false);
  });

  it("is false when zellij reports no sessions", () => {
    const { terminal } = fakeZellij({ failListing: true });
    assert.equal(terminal.isAvailable(), false);
  });
});

describe("open", () => {
  it("opens a named tab and runs the command in a pane of it", () => {
    const { fake, terminal } = fakeZellij({ sessions: "agents [Created 1h ago]" });
    terminal.open(request);
    assert.deepEqual(fake.calls.slice(1), [
      ["--session", "agents", "action", "new-tab", "--name", "digest", "--layout-string", 'layout {\n  pane command="sleep" close_on_exit=true {\n    args "3"\n  }\n}'],
      ["--session", "agents", "run", "--tab-id", "4", "--cwd", "/work", "--name", "digest", "--close-on-exit", "--", "node", "cli.ts", "run", "digest"],
    ]);
  });

  it("creates the session in the background when it does not exist", () => {
    const { fake, terminal } = fakeZellij({ sessions: "main [Created 1h ago]" });
    terminal.open(request);
    assert.deepEqual(fake.calls[1], ["attach", "--create-background", "agents"]);
  });

  it("replaces an exited session before opening", () => {
    const { fake, terminal } = fakeZellij({ sessions: "agents [Created 1h ago] (EXITED - attach to resurrect)" });
    terminal.open(request);
    assert.deepEqual(fake.calls.slice(1, 3), [["delete-session", "agents"], ["attach", "--create-background", "agents"]]);
  });
});

describe("currentHandle", () => {
  it("reads the session and pane from zellij's environment", () => {
    const { terminal } = fakeZellij();
    assert.deepEqual(terminal.currentHandle({ ZELLIJ_SESSION_NAME: "agents", ZELLIJ_PANE_ID: "5" }), { session: "agents", paneId: "terminal_5" });
  });

  it("is null outside zellij", () => {
    const { terminal } = fakeZellij();
    assert.equal(terminal.currentHandle({}), null);
  });
});

describe("isLive", () => {
  const handle = { session: "agents", paneId: "terminal_5" };

  it("is true when the pane is listed and running", () => {
    const panes = JSON.stringify([
      { id: 0, is_plugin: true, exited: false, title: "status" },
      { id: 5, is_plugin: false, exited: false, title: "digest" },
    ]);
    const { terminal } = fakeZellij({ sessions: "agents [Created 1h ago]", panes });
    assert.equal(terminal.isLive(handle), true);
  });

  it("is false when the pane has exited or is missing", () => {
    const panes = JSON.stringify([{ id: 5, is_plugin: false, exited: true }]);
    assert.equal(fakeZellij({ sessions: "agents [Created 1h ago]", panes }).terminal.isLive(handle), false);
    assert.equal(fakeZellij({ sessions: "agents [Created 1h ago]", panes: "[]" }).terminal.isLive(handle), false);
  });

  it("does not match a plugin pane with the same number", () => {
    const panes = JSON.stringify([{ id: 5, is_plugin: true, exited: false }]);
    assert.equal(fakeZellij({ sessions: "agents [Created 1h ago]", panes }).terminal.isLive(handle), false);
  });

  it("is false without listing panes when the session is gone", () => {
    const { fake, terminal } = fakeZellij({ sessions: "main [Created 1h ago]" });
    assert.equal(terminal.isLive(handle), false);
    assert.equal(fake.calls.some((call) => call.includes("list-panes")), false);
  });
});

describe("deliver", () => {
  it("pastes the text into the pane and presses Enter", () => {
    const { fake, terminal } = fakeZellij();
    terminal.deliver({ session: "agents", paneId: "terminal_5" }, "Your instructions are in /agents/digest.md.");
    assert.deepEqual(fake.calls, [
      ["--session", "agents", "action", "paste", "--pane-id", "terminal_5", "Your instructions are in /agents/digest.md."],
      ["--session", "agents", "action", "send-keys", "--pane-id", "terminal_5", "Enter"],
    ]);
  });
});
