import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, it } from "node:test";
import { type FakeTerminal, fakeRuntime, fakeTerminal } from "#testing/fakes.ts";
import { LaunchOutcome, launch } from "./launcher.ts";
import { type Runtime, sessionsDirectory } from "./runtime.ts";
import { acquireSession, readOpenedHandle, recordOpenedHandle } from "./session.ts";
import { type AgentSpec, parseSpec } from "./spec.ts";

interface Setup {
  terminal: FakeTerminal;
  runtime: Runtime;
  spec: AgentSpec;
}

function setup(frontmatter: string): Setup {
  const terminal = fakeTerminal();
  const runtime = fakeRuntime({ terminal, supervisorCommand: ["node", "/cadence/src/cli.ts"] });
  const spec = parseSpec({ name: "agent", file: "/agents/agent.md", text: `---\n${frontmatter}\n---\n` }, runtime);
  return { terminal, runtime, spec };
}

function holdSession(runtime: Runtime, pid = process.pid): void {
  acquireSession(sessionsDirectory(runtime), "agent", { pid, startedAt: "2026-10-16T09:00:00.000Z" });
}

function recordHandle(runtime: Runtime, handle: unknown): void {
  recordOpenedHandle(sessionsDirectory(runtime), "agent", handle);
}

describe("launch", () => {
  describe("with no live session", () => {
    it("should open a terminal session running the supervisor", () => {
      const { terminal, runtime, spec } = setup('schedule: "* * * * *"\nsession: agents\ncwd: /work');

      const outcome = launch(spec, runtime);

      assert.equal(outcome, LaunchOutcome.Started);
      assert.deepEqual(terminal.opened, [
        { title: "agent", cwd: "/work", command: ["node", "/cadence/src/cli.ts", "run", "agent"], options: { session: "agents" }, replacing: null },
      ]);
    });

    it("should record the new session's handle", () => {
      const { runtime, spec } = setup('schedule: "* * * * *"');

      launch(spec, runtime);

      assert.deepEqual(readOpenedHandle(sessionsDirectory(runtime), "agent"), { pane: "opened-1" });
    });

    it("should open the new session in place of the previous one, then close the previous one", () => {
      const { terminal, runtime, spec } = setup('schedule: "* * * * *"');
      recordHandle(runtime, { pane: "3" });

      launch(spec, runtime);

      assert.deepEqual(terminal.opened[0]?.replacing, { pane: "3" });
      assert.deepEqual(terminal.closed, ["3"]);
      assert.deepEqual(readOpenedHandle(sessionsDirectory(runtime), "agent"), { pane: "opened-1" });
    });

    it("should close nothing when there is no usable previous handle", () => {
      const { terminal, runtime, spec } = setup('schedule: "* * * * *"');
      recordHandle(runtime, { window: 3 });

      launch(spec, runtime);

      assert.equal(terminal.opened[0]?.replacing, null);
      assert.deepEqual(terminal.closed, []);
    });

    it("should let terminal errors propagate, keeping the previous handle to close next time", () => {
      const { terminal, runtime, spec } = setup('schedule: "* * * * *"');
      recordHandle(runtime, { pane: "3" });
      terminal.openError = new Error("no session");

      assert.throws(() => launch(spec, runtime), /no session/);
      assert.deepEqual(terminal.closed, []);
      assert.deepEqual(readOpenedHandle(sessionsDirectory(runtime), "agent"), { pane: "3" });
    });
  });

  describe("with a live session", () => {
    it("should replace a non-resident agent's session: stop it, open a new one, then close the old", async () => {
      const { terminal, runtime, spec } = setup('schedule: "* * * * *"');
      const previousSession = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
      const previousExit = once(previousSession, "exit");
      assert.ok(previousSession.pid);
      holdSession(runtime, previousSession.pid);
      recordHandle(runtime, { pane: "7" });

      const outcome = launch(spec, runtime);

      const [, exitSignal] = await previousExit;
      assert.equal(outcome, LaunchOutcome.Replaced);
      assert.equal(exitSignal, "SIGTERM");
      assert.deepEqual(terminal.opened[0]?.replacing, { pane: "7" });
      assert.deepEqual(terminal.closed, ["7"]);
    });

    it("should prompt a resident agent's session", () => {
      const { terminal, runtime, spec } = setup('schedule: "* * * * *"\nreuse: true');
      holdSession(runtime);
      recordHandle(runtime, { pane: "7" });
      terminal.livePanes.add("7");

      const outcome = launch(spec, runtime);

      assert.equal(outcome, LaunchOutcome.Prompted);
      assert.equal(terminal.opened.length, 0);
      assert.equal(terminal.delivered.length, 1);
      assert.equal(terminal.delivered[0]?.pane, "7");
      assert.match(terminal.delivered[0]?.text ?? "", /Your instructions are in \/agents\/agent\.md/);
    });

    it("should report busy when a resident agent's pane is gone", () => {
      const { terminal, runtime, spec } = setup('schedule: "* * * * *"\nreuse: true');
      holdSession(runtime);
      recordHandle(runtime, { pane: "7" });

      const outcome = launch(spec, runtime);

      assert.equal(outcome, LaunchOutcome.Busy);
      assert.equal(terminal.delivered.length, 0);
    });

    it("should report busy when no usable handle was recorded", () => {
      const { runtime, spec } = setup('schedule: "* * * * *"\nreuse: true');
      holdSession(runtime);

      assert.equal(launch(spec, runtime), LaunchOutcome.Busy);
    });
  });
});
