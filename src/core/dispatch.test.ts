import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fakeRuntime, fakeTerminal, writeSpec } from "../testing/fakes.ts";
import { dispatch } from "./dispatch.ts";
import type { Gate } from "./ports.ts";
import { dispatchLog, type Runtime, sessionsDirectory, stateFile } from "./runtime.ts";
import { acquireSession } from "./session.ts";
import { loadState } from "./state.ts";

const nineOClock = new Date(2026, 9, 16, 9, 0, 20);
const minute = 60_000;

function at(offsetMinutes: number): Date {
  return new Date(nineOClock.getTime() + offsetMinutes * minute);
}

function setup(gates: Gate[] = []) {
  const terminal = fakeTerminal();
  const runtime = fakeRuntime({ terminal, gates });
  mkdirSync(runtime.agentsDirectory, { recursive: true });
  return { terminal, runtime };
}

function agentState(runtime: Runtime, name: string) {
  return loadState(stateFile(runtime)).agents[name];
}

function logLines(runtime: Runtime): string[] {
  if (!existsSync(dispatchLog(runtime))) return [];
  return readFileSync(dispatchLog(runtime), "utf8").trim().split("\n").map((line) => line.replace(/^\S+ /, ""));
}

describe("dispatch", () => {
  it("does nothing when the agents directory is missing", () => {
    const runtime = fakeRuntime();
    dispatch(runtime, nineOClock);
    assert.equal(existsSync(stateFile(runtime)), false);
  });

  it("registers a new agent without launching it", () => {
    const { terminal, runtime } = setup();
    writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"');
    dispatch(runtime, nineOClock);
    assert.equal(terminal.opened.length, 0);
    assert.equal(agentState(runtime, "agent")?.lastChecked, new Date(2026, 9, 16, 9, 0).toISOString());
  });

  it("launches a registered agent once it comes due", () => {
    const { terminal, runtime } = setup();
    writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"');
    dispatch(runtime, nineOClock);
    dispatch(runtime, at(1));
    assert.equal(terminal.opened.length, 1);
    assert.equal(agentState(runtime, "agent")?.lastStarted, at(1).toISOString());
    assert.deepEqual(logLines(runtime), ["started agent"]);
  });

  it("collapses several missed minutes into one launch", () => {
    const { terminal, runtime } = setup();
    writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"');
    dispatch(runtime, nineOClock);
    dispatch(runtime, at(30));
    assert.equal(terminal.opened.length, 1);
  });

  it("leaves a disabled agent alone but keeps its check current", () => {
    const { terminal, runtime } = setup();
    writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"\nenabled: false');
    dispatch(runtime, nineOClock);
    dispatch(runtime, at(1));
    assert.equal(terminal.opened.length, 0);
    assert.equal(agentState(runtime, "agent")?.lastChecked, new Date(2026, 9, 16, 9, 1).toISOString());
  });

  it("defers a due agent while the terminal is unavailable, then catches up", () => {
    const { terminal, runtime } = setup();
    writeSpec(runtime.agentsDirectory, "agent", 'schedule: "0 9 * * *"');
    dispatch(runtime, at(-1));
    terminal.available = false;
    dispatch(runtime, nineOClock);
    dispatch(runtime, at(5));
    assert.equal(terminal.opened.length, 0);
    assert.equal(agentState(runtime, "agent")?.lastChecked, new Date(2026, 9, 16, 8, 59).toISOString());

    terminal.available = true;
    dispatch(runtime, at(6));
    assert.equal(terminal.opened.length, 1);
  });

  it("logs busy and moves on when a bounded agent is still running", () => {
    const { terminal, runtime } = setup();
    writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"');
    acquireSession(sessionsDirectory(runtime), "agent", { pid: process.pid, startedAt: "x", handle: { pane: "1" } });
    dispatch(runtime, nineOClock);
    dispatch(runtime, at(1));
    assert.equal(terminal.opened.length, 0);
    assert.equal(agentState(runtime, "agent")?.lastStarted, undefined);
    assert.equal(agentState(runtime, "agent")?.lastChecked, new Date(2026, 9, 16, 9, 1).toISOString());
    assert.deepEqual(logLines(runtime), ["busy agent"]);
  });

  it("retries a failed launch every minute and logs the failure once", () => {
    const { terminal, runtime } = setup();
    writeSpec(runtime.agentsDirectory, "agent", 'schedule: "0 9 * * *"');
    dispatch(runtime, at(-1));
    terminal.failOpenWith = new Error("zellij is wedged");
    dispatch(runtime, nineOClock);
    dispatch(runtime, at(1));
    assert.equal(agentState(runtime, "agent")?.lastError, "zellij is wedged");
    assert.deepEqual(logLines(runtime), ["failed agent: zellij is wedged"]);

    terminal.failOpenWith = null;
    dispatch(runtime, at(2));
    assert.equal(terminal.opened.length, 1);
    assert.equal(agentState(runtime, "agent")?.lastError, undefined);
  });

  it("logs an invalid spec once and clears the error when it is fixed", () => {
    const { terminal, runtime } = setup();
    writeSpec(runtime.agentsDirectory, "agent", "schedule: nonsense");
    dispatch(runtime, nineOClock);
    dispatch(runtime, at(1));
    assert.equal(logLines(runtime).length, 1);
    assert.match(logLines(runtime)[0] ?? "", /^failed agent: schedule "nonsense" needs five fields$/);

    writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"');
    dispatch(runtime, at(2));
    assert.equal(agentState(runtime, "agent")?.lastError, undefined);
    assert.equal(terminal.opened.length, 1);
  });

  it("stops at a gate that is not ready and keeps the gate's memory", () => {
    const gate: Gate = { key: "never", check: (memory) => ({ ready: false, memory: { calls: ((memory as { calls?: number } | undefined)?.calls ?? 0) + 1 } }) };
    const { terminal, runtime } = setup([gate]);
    writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"');
    dispatch(runtime, nineOClock);
    dispatch(runtime, at(1));
    const state = loadState(stateFile(runtime));
    assert.deepEqual(state.gates.never, { calls: 2 });
    assert.deepEqual(state.agents, {});
    assert.equal(terminal.opened.length, 0);
  });

  it("asks the terminal for availability at most once per tick", () => {
    const { terminal, runtime } = setup();
    let availabilityChecks = 0;
    terminal.isAvailable = () => {
      availabilityChecks += 1;
      return true;
    };
    writeSpec(runtime.agentsDirectory, "first", 'schedule: "* * * * *"');
    writeSpec(runtime.agentsDirectory, "second", 'schedule: "* * * * *"');
    dispatch(runtime, nineOClock);
    dispatch(runtime, at(1));
    assert.equal(availabilityChecks, 1);
    assert.equal(terminal.opened.length, 2);
  });
});
