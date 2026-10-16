import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type FakeTerminal, fakeRuntime, fakeTerminal } from "#testing/fakes.ts";
import { LaunchOutcome, launch } from "./launcher.ts";
import { type Runtime, sessionsDirectory } from "./runtime.ts";
import { acquireSession } from "./session.ts";
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

function holdSession(runtime: Runtime, handle: unknown): void {
  acquireSession(sessionsDirectory(runtime), "agent", { pid: process.pid, startedAt: "2026-10-16T09:00:00.000Z", handle });
}

describe("launch", () => {
  describe("with no live session", () => {
    it("should open a terminal session running the supervisor", () => {
      const { terminal, runtime, spec } = setup('schedule: "* * * * *"\nsession: agents\ncwd: /work');

      const outcome = launch(spec, runtime);

      assert.equal(outcome, LaunchOutcome.Started);
      assert.deepEqual(terminal.opened, [
        { title: "agent", cwd: "/work", command: ["node", "/cadence/src/cli.ts", "run", "agent"], options: { session: "agents" } },
      ]);
    });

    it("should let terminal errors propagate", () => {
      const { terminal, runtime, spec } = setup('schedule: "* * * * *"');
      terminal.openError = new Error("no session");

      assert.throws(() => launch(spec, runtime), /no session/);
    });
  });

  describe("with a live session", () => {
    it("should report busy for a bounded agent", () => {
      const { terminal, runtime, spec } = setup('schedule: "* * * * *"');
      holdSession(runtime, { pane: "7" });
      terminal.livePanes.add("7");

      const outcome = launch(spec, runtime);

      assert.equal(outcome, LaunchOutcome.Busy);
      assert.equal(terminal.opened.length, 0);
      assert.equal(terminal.delivered.length, 0);
    });

    it("should prompt a resident agent's session", () => {
      const { terminal, runtime, spec } = setup('schedule: "* * * * *"\nreuse: true');
      holdSession(runtime, { pane: "7" });
      terminal.livePanes.add("7");

      const outcome = launch(spec, runtime);

      assert.equal(outcome, LaunchOutcome.Prompted);
      assert.equal(terminal.delivered.length, 1);
      assert.equal(terminal.delivered[0]?.pane, "7");
      assert.match(terminal.delivered[0]?.text ?? "", /Your instructions are in \/agents\/agent\.md/);
    });

    it("should report busy when a resident agent's pane is gone", () => {
      const { terminal, runtime, spec } = setup('schedule: "* * * * *"\nreuse: true');
      holdSession(runtime, { pane: "7" });

      const outcome = launch(spec, runtime);

      assert.equal(outcome, LaunchOutcome.Busy);
      assert.equal(terminal.delivered.length, 0);
    });

    it("should report busy when the session recorded no usable handle", () => {
      const { runtime, spec } = setup('schedule: "* * * * *"\nreuse: true');
      holdSession(runtime, null);

      assert.equal(launch(spec, runtime), LaunchOutcome.Busy);
    });
  });
});
