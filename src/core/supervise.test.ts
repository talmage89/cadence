import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import { fakeRuntime, fakeTerminal, temporaryDirectory } from "../testing/fakes.ts";
import type { Runner } from "./ports.ts";
import { agentLog, type Runtime, sessionsDirectory } from "./runtime.ts";
import { acquireSession } from "./session.ts";
import type { AgentSpec, Lifetime } from "./spec.ts";
import { parseSchedule } from "./cron.ts";
import { supervise } from "./supervise.ts";

function agentSpec(script: string, lifetime: Lifetime = { kind: "resident" }, cwd = temporaryDirectory()): AgentSpec {
  return {
    name: "agent",
    file: "/agents/agent.md",
    schedule: parseSchedule("* * * * *"),
    enabled: true,
    cwd,
    lifetime,
    runnerOptions: { script },
    terminalOptions: {},
  };
}

function logLines(runtime: Runtime): string[] {
  return readFileSync(agentLog(runtime, "agent"), "utf8").trim().split("\n").map((line) => line.replace(/^\S+ /, ""));
}

function recordFile(runtime: Runtime): string {
  return join(sessionsDirectory(runtime), "agent.json");
}

describe("supervise", () => {
  it("runs the runner's command in the agent's cwd and returns its exit code", async () => {
    const runtime = fakeRuntime();
    const cwd = temporaryDirectory();
    const marker = join(cwd, "ran");
    const script = `require("fs").writeFileSync(${JSON.stringify(marker)}, process.cwd()); process.exit(3)`;

    assert.equal(await supervise(agentSpec(script, { kind: "resident" }, cwd), runtime), 3);
    assert.equal(readFileSync(marker, "utf8"), cwd);
    assert.deepEqual(logLines(runtime), ["started (resident)", "exited with code 3"]);
  });

  it("holds the session record with the terminal's handle while running, then releases it", async () => {
    const terminal = fakeTerminal();
    terminal.environmentHandle = { pane: "9" };
    const runtime = fakeRuntime({ terminal });
    const copy = join(temporaryDirectory(), "record.json");
    const script = `const fs = require("fs"); fs.copyFileSync(${JSON.stringify(recordFile(runtime))}, ${JSON.stringify(copy)})`;

    assert.equal(await supervise(agentSpec(script), runtime), 0);
    const record = JSON.parse(readFileSync(copy, "utf8"));
    assert.equal(record.pid, process.pid);
    assert.deepEqual(record.handle, { pane: "9" });
    assert.equal(existsSync(recordFile(runtime)), false);
  });

  it("stops a bounded agent at its timeout", async () => {
    const runtime = fakeRuntime();
    const started = Date.now();

    const exitCode = await supervise(agentSpec("setInterval(() => {}, 1000)", { kind: "bounded", timeoutMilliseconds: 300 }), runtime);
    assert.equal(exitCode, 1);
    assert.ok(Date.now() - started < 5_000);
    assert.deepEqual(logLines(runtime), ["started (bounded)", "timed out after 300ms", "exited with signal SIGTERM"]);
    assert.equal(existsSync(recordFile(runtime)), false);
  });

  it("refuses to start while another session of the agent is live", async () => {
    const runtime = fakeRuntime();
    acquireSession(sessionsDirectory(runtime), "agent", { pid: process.pid, startedAt: "x", handle: null });
    const marker = join(temporaryDirectory(), "ran");

    assert.equal(await supervise(agentSpec(`require("fs").writeFileSync(${JSON.stringify(marker)}, "")`), runtime), 1);
    assert.equal(existsSync(marker), false);
    assert.deepEqual(logLines(runtime), ["not started: another session of this agent is running"]);
    assert.equal(existsSync(recordFile(runtime)), true);
  });

  it("reports a command that cannot start and releases the record", async () => {
    const options = z.object({ script: z.string() });
    const missingRunner: Runner<typeof options> = { options, command: () => ["/nonexistent/agent-cli"] };
    const runtime = fakeRuntime({ runner: missingRunner });

    assert.equal(await supervise(agentSpec(""), runtime), 1);
    assert.match(logLines(runtime).at(-1) ?? "", /^failed: spawn \/nonexistent\/agent-cli ENOENT$/);
    assert.equal(existsSync(recordFile(runtime)), false);
  });

  it("reports an empty runner command", async () => {
    const options = z.object({ script: z.string() });
    const emptyRunner: Runner<typeof options> = { options, command: () => [] };
    const runtime = fakeRuntime({ runner: emptyRunner });

    assert.equal(await supervise(agentSpec(""), runtime), 1);
    assert.deepEqual(logLines(runtime), ["failed: the runner produced an empty command"]);
  });
});
