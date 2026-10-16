import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeRuntime, fakeTerminal } from "../testing/fakes.ts";
import { launch } from "./launch.ts";
import { sessionsDirectory } from "./runtime.ts";
import { acquireSession } from "./session.ts";
import { parseSpec } from "./spec.ts";

function setup(frontmatter: string) {
  const terminal = fakeTerminal();
  const runtime = fakeRuntime({ terminal, supervisorCommand: ["node", "/cadence/src/cli.ts"] });
  const spec = parseSpec("agent", "/agents/agent.md", `---\n${frontmatter}\n---\n`, runtime);
  return { terminal, runtime, spec };
}

function holdSession(runtime: ReturnType<typeof fakeRuntime>, handle: unknown) {
  acquireSession(sessionsDirectory(runtime), "agent", { pid: process.pid, startedAt: "2026-10-16T09:00:00.000Z", handle });
}

describe("launch", () => {
  it("opens a terminal session running the supervisor when none is live", () => {
    const { terminal, runtime, spec } = setup('schedule: "* * * * *"\nsession: agents\ncwd: /work');
    assert.deepEqual(launch(spec, runtime), { kind: "started" });
    assert.deepEqual(terminal.opened, [
      { title: "agent", cwd: "/work", command: ["node", "/cadence/src/cli.ts", "run", "agent"], options: { session: "agents" } },
    ]);
  });

  it("reports busy for a bounded agent that is still running", () => {
    const { terminal, runtime, spec } = setup('schedule: "* * * * *"');
    holdSession(runtime, { pane: "7" });
    terminal.livePanes.add("7");
    assert.deepEqual(launch(spec, runtime), { kind: "busy" });
    assert.equal(terminal.opened.length, 0);
    assert.equal(terminal.delivered.length, 0);
  });

  it("prompts a resident agent's live session", () => {
    const { terminal, runtime, spec } = setup('schedule: "* * * * *"\nreuse: true');
    holdSession(runtime, { pane: "7" });
    terminal.livePanes.add("7");
    assert.deepEqual(launch(spec, runtime), { kind: "prompted" });
    assert.equal(terminal.delivered.length, 1);
    assert.equal(terminal.delivered[0]?.pane, "7");
    assert.match(terminal.delivered[0]?.text ?? "", /Your instructions are in \/agents\/agent\.md/);
  });

  it("reports busy when a resident agent's pane is gone", () => {
    const { terminal, runtime, spec } = setup('schedule: "* * * * *"\nreuse: true');
    holdSession(runtime, { pane: "7" });
    assert.deepEqual(launch(spec, runtime), { kind: "busy" });
    assert.equal(terminal.delivered.length, 0);
  });

  it("reports busy when the session recorded no usable handle", () => {
    const { runtime, spec } = setup('schedule: "* * * * *"\nreuse: true');
    holdSession(runtime, null);
    assert.deepEqual(launch(spec, runtime), { kind: "busy" });
  });

  it("lets terminal errors propagate", () => {
    const { terminal, runtime, spec } = setup('schedule: "* * * * *"');
    terminal.failOpenWith = new Error("no session");
    assert.throws(() => launch(spec, runtime), /no session/);
  });
});

describe("fakeTerminal", () => {
  it("starts available with nothing live", () => {
    const terminal = fakeTerminal();
    assert.equal(terminal.isAvailable(), true);
    assert.equal(terminal.isLive({ pane: "1" }), false);
  });
});
