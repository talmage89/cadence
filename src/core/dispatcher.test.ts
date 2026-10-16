import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import { describe, it } from "node:test";
import { z } from "zod";
import { type FakeTerminal, fakeRuntime, fakeTerminal, readLogMessages, writeSpec } from "#testing/fakes.ts";
import { dispatch } from "./dispatcher.ts";
import { minuteMilliseconds } from "./duration.ts";
import type { Gate } from "./ports.ts";
import { dispatchLog, type Runtime, sessionsDirectory, stateFile } from "./runtime.ts";
import { acquireSession } from "./session.ts";
import { type AgentState, loadState } from "./state.ts";

const nineOClock = new Date(2026, 9, 16, 9, 0, 20);

function minutesAfterNine(minutes: number): Date {
  return new Date(nineOClock.getTime() + minutes * minuteMilliseconds);
}

function minuteStamp(hour: number, minute: number): string {
  return new Date(2026, 9, 16, hour, minute).toISOString();
}

function setup(gates: Gate[] = []): { terminal: FakeTerminal; runtime: Runtime } {
  const terminal = fakeTerminal();
  const runtime = fakeRuntime({ terminal, gates });
  mkdirSync(runtime.agentsDirectory, { recursive: true });
  return { terminal, runtime };
}

function agentState(runtime: Runtime, name: string): AgentState | undefined {
  return loadState(stateFile(runtime)).agents[name];
}

describe("dispatch", () => {
  describe("registration", () => {
    it("should do nothing when the agents directory is missing", () => {
      const runtime = fakeRuntime();

      dispatch(runtime, nineOClock);

      assert.equal(existsSync(stateFile(runtime)), false);
    });

    it("should register a new agent without launching it", () => {
      const { terminal, runtime } = setup();
      writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"');

      dispatch(runtime, nineOClock);

      assert.equal(terminal.opened.length, 0);
      assert.equal(agentState(runtime, "agent")?.lastChecked, minuteStamp(9, 0));
    });
  });

  describe("scheduling", () => {
    it("should launch a registered agent once it comes due", () => {
      const { terminal, runtime } = setup();
      writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"');
      dispatch(runtime, nineOClock);

      dispatch(runtime, minutesAfterNine(1));

      assert.equal(terminal.opened.length, 1);
      assert.equal(agentState(runtime, "agent")?.lastStarted, minutesAfterNine(1).toISOString());
      assert.deepEqual(readLogMessages(dispatchLog(runtime)), ["started agent"]);
    });

    it("should collapse several missed minutes into one launch", () => {
      const { terminal, runtime } = setup();
      writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"');
      dispatch(runtime, nineOClock);

      dispatch(runtime, minutesAfterNine(30));

      assert.equal(terminal.opened.length, 1);
    });

    it("should leave a disabled agent alone but keep its check current", () => {
      const { terminal, runtime } = setup();
      writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"\nenabled: false');
      dispatch(runtime, nineOClock);

      dispatch(runtime, minutesAfterNine(1));

      assert.equal(terminal.opened.length, 0);
      assert.equal(agentState(runtime, "agent")?.lastChecked, minuteStamp(9, 1));
    });

    it("should log busy and move on when a resident agent's session cannot be reached", () => {
      const { terminal, runtime } = setup();
      writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"\nreuse: true');
      acquireSession(sessionsDirectory(runtime), "agent", { pid: process.pid, startedAt: "2026-10-16T08:00:00.000Z", handle: { pane: "1" } });
      dispatch(runtime, nineOClock);

      dispatch(runtime, minutesAfterNine(1));

      assert.equal(terminal.opened.length, 0);
      assert.equal(agentState(runtime, "agent")?.lastStarted, undefined);
      assert.equal(agentState(runtime, "agent")?.lastChecked, minuteStamp(9, 1));
      assert.deepEqual(readLogMessages(dispatchLog(runtime)), ["busy agent"]);
    });

    it("should log a replaced run as a start", async () => {
      const { terminal, runtime } = setup();
      writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"');
      const previousSession = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
      const previousExit = once(previousSession, "exit");
      assert.ok(previousSession.pid);
      acquireSession(sessionsDirectory(runtime), "agent", { pid: previousSession.pid, startedAt: "2026-10-16T08:00:00.000Z", handle: { pane: "1" } });
      dispatch(runtime, nineOClock);

      dispatch(runtime, minutesAfterNine(1));

      await previousExit;
      assert.equal(terminal.opened.length, 1);
      assert.equal(agentState(runtime, "agent")?.lastStarted, minutesAfterNine(1).toISOString());
      assert.deepEqual(readLogMessages(dispatchLog(runtime)), ["replaced agent"]);
    });
  });

  describe("deferral", () => {
    it("should hold a due agent while the terminal is unavailable, then catch up", () => {
      const { terminal, runtime } = setup();
      writeSpec(runtime.agentsDirectory, "agent", 'schedule: "0 9 * * *"');
      dispatch(runtime, minutesAfterNine(-1));
      terminal.isReachable = false;

      dispatch(runtime, nineOClock);
      dispatch(runtime, minutesAfterNine(5));

      assert.equal(terminal.opened.length, 0);
      assert.equal(agentState(runtime, "agent")?.lastChecked, minuteStamp(8, 59));

      terminal.isReachable = true;
      dispatch(runtime, minutesAfterNine(6));

      assert.equal(terminal.opened.length, 1);
    });

    it("should retry a failed launch every minute and log the failure once", () => {
      const { terminal, runtime } = setup();
      writeSpec(runtime.agentsDirectory, "agent", 'schedule: "0 9 * * *"');
      dispatch(runtime, minutesAfterNine(-1));
      terminal.openError = new Error("zellij is wedged");

      dispatch(runtime, nineOClock);
      dispatch(runtime, minutesAfterNine(1));

      assert.equal(agentState(runtime, "agent")?.lastError, "zellij is wedged");
      assert.deepEqual(readLogMessages(dispatchLog(runtime)), ["failed agent: zellij is wedged"]);

      terminal.openError = null;
      dispatch(runtime, minutesAfterNine(2));

      assert.equal(terminal.opened.length, 1);
      assert.equal(agentState(runtime, "agent")?.lastError, undefined);
    });
  });

  describe("invalid specs", () => {
    it("should log the error once and clear it when the spec is fixed", () => {
      const { terminal, runtime } = setup();
      writeSpec(runtime.agentsDirectory, "agent", "schedule: nonsense");

      dispatch(runtime, nineOClock);
      dispatch(runtime, minutesAfterNine(1));

      assert.deepEqual(readLogMessages(dispatchLog(runtime)), ['failed agent: schedule: "nonsense" needs 5 fields']);

      writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"');
      dispatch(runtime, minutesAfterNine(2));

      assert.equal(agentState(runtime, "agent")?.lastError, undefined);
      assert.equal(terminal.opened.length, 1);
    });
  });

  describe("gates", () => {
    it("should stop at a gate that is not ready and keep the gate's memory", () => {
      const callCountSchema = z.object({ calls: z.number() }).catch({ calls: 0 });
      const gate: Gate = {
        key: "never",
        check: (memory) => ({ ready: false, memory: { calls: callCountSchema.parse(memory).calls + 1 } }),
      };
      const { terminal, runtime } = setup([gate]);
      writeSpec(runtime.agentsDirectory, "agent", 'schedule: "* * * * *"');

      dispatch(runtime, nineOClock);
      dispatch(runtime, minutesAfterNine(1));

      const state = loadState(stateFile(runtime));
      assert.deepEqual(state.gates.never, { calls: 2 });
      assert.deepEqual(state.agents, {});
      assert.equal(terminal.opened.length, 0);
    });
  });

  describe("terminal availability", () => {
    it("should be asked at most once per tick", () => {
      const { terminal, runtime } = setup();
      let availabilityChecks = 0;
      terminal.isAvailable = () => {
        availabilityChecks += 1;
        return true;
      };
      writeSpec(runtime.agentsDirectory, "first", 'schedule: "* * * * *"');
      writeSpec(runtime.agentsDirectory, "second", 'schedule: "* * * * *"');
      dispatch(runtime, nineOClock);

      dispatch(runtime, minutesAfterNine(1));

      assert.equal(availabilityChecks, 1);
      assert.equal(terminal.opened.length, 2);
    });
  });
});
