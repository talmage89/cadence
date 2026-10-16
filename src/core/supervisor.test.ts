import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import { fakeRuntime, fakeTerminal, readLogMessages, temporaryDirectory } from "#testing/fakes.ts";
import { scheduleSchema } from "./cron.ts";
import type { Runner } from "./ports.ts";
import { agentLog, type Runtime, sessionsDirectory } from "./runtime.ts";
import { acquireSession } from "./session.ts";
import { type AgentSpec, Lifetime } from "./spec.ts";
import { supervise } from "./supervisor.ts";
import { jsonSchema } from "./validation.ts";

function agentSpec(script: string, cwd = temporaryDirectory()): AgentSpec {
  return {
    name: "agent",
    file: "/agents/agent.md",
    schedule: scheduleSchema.parse("* * * * *"),
    enabled: true,
    cwd,
    lifetime: Lifetime.Replaced,
    runnerOptions: { script },
    terminalOptions: {},
  };
}

function fixedRunner(command: string[]): Runner {
  return { options: z.object({ script: z.string() }), command: () => command };
}

function agentLogMessages(runtime: Runtime): string[] {
  return readLogMessages(agentLog(runtime, "agent"));
}

function recordFile(runtime: Runtime): string {
  return join(sessionsDirectory(runtime), "agent.json");
}

describe("supervise", () => {
  describe("running", () => {
    it("should run the runner's command in the agent's cwd and return its exit code", async () => {
      const runtime = fakeRuntime();
      const cwd = temporaryDirectory();
      const marker = join(cwd, "ran");
      const script = `require("fs").writeFileSync(${JSON.stringify(marker)}, process.cwd()); process.exit(3)`;

      const exitCode = await supervise(agentSpec(script, cwd), runtime);

      assert.equal(exitCode, 3);
      assert.equal(readFileSync(marker, "utf8"), cwd);
      assert.deepEqual(agentLogMessages(runtime), ["started (replaced)", "exited with code 3"]);
    });

    it("should hold the session record with the terminal's handle while running, then release it", async () => {
      const terminal = fakeTerminal();
      terminal.environmentHandle = { pane: "9" };
      const runtime = fakeRuntime({ terminal });
      const copy = join(temporaryDirectory(), "record.json");
      const script = `require("fs").copyFileSync(${JSON.stringify(recordFile(runtime))}, ${JSON.stringify(copy)})`;

      const exitCode = await supervise(agentSpec(script), runtime);

      const heldRecord = jsonSchema(z.object({ pid: z.number(), handle: z.unknown() })).parse(readFileSync(copy, "utf8"));
      assert.equal(exitCode, 0);
      assert.equal(heldRecord.pid, process.pid);
      assert.deepEqual(heldRecord.handle, { pane: "9" });
      assert.equal(existsSync(recordFile(runtime)), false);
    });
  });

  describe("waiting for the previous session", () => {
    it("should start once the previous session lets go of the lock", async () => {
      const runtime = fakeRuntime();
      const previousSession = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"]);
      acquireSession(sessionsDirectory(runtime), "agent", { pid: previousSession.pid ?? 0, startedAt: "2026-10-16T08:00:00.000Z", handle: null });

      const exitCode = await supervise(agentSpec(""), runtime, { lockWaitMilliseconds: 5_000 });

      assert.equal(exitCode, 0);
      assert.deepEqual(agentLogMessages(runtime), ["started (replaced)", "exited with code 0"]);
    });

    it("should give up when the previous session holds on past the wait", async () => {
      const runtime = fakeRuntime();
      acquireSession(sessionsDirectory(runtime), "agent", { pid: process.pid, startedAt: "2026-10-16T08:00:00.000Z", handle: null });
      const marker = join(temporaryDirectory(), "ran");

      const exitCode = await supervise(agentSpec(`require("fs").writeFileSync(${JSON.stringify(marker)}, "")`), runtime, { lockWaitMilliseconds: 300 });

      assert.equal(exitCode, 1);
      assert.equal(existsSync(marker), false);
      assert.deepEqual(agentLogMessages(runtime), ["not started: another session of this agent is still running"]);
      assert.equal(existsSync(recordFile(runtime)), true);
    });
  });

  describe("failure", () => {

    it("should report a command that cannot start and release the record", async () => {
      const runtime = fakeRuntime({ runner: fixedRunner(["/nonexistent/agent-cli"]) });

      const exitCode = await supervise(agentSpec(""), runtime);

      assert.equal(exitCode, 1);
      assert.match(agentLogMessages(runtime).at(-1) ?? "", /^failed: spawn \/nonexistent\/agent-cli ENOENT$/);
      assert.equal(existsSync(recordFile(runtime)), false);
    });

    it("should report an empty runner command", async () => {
      const runtime = fakeRuntime({ runner: fixedRunner([]) });

      const exitCode = await supervise(agentSpec(""), runtime);

      assert.equal(exitCode, 1);
      assert.deepEqual(agentLogMessages(runtime), ["failed: the runner produced an empty command"]);
    });
  });
});
