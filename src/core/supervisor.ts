import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { secondMilliseconds } from "./duration.ts";
import { appendLog } from "./log.ts";
import { agentLog, type Runtime, sessionsDirectory } from "./runtime.ts";
import { acquireSession, releaseSession, type SessionRecord } from "./session.ts";
import { type AgentSpec, instructionsPrompt } from "./spec.ts";
import { describeError } from "./validation.ts";

export interface SuperviseParams {
  lockWaitMilliseconds?: number;
}

export async function supervise(spec: AgentSpec, runtime: Runtime, { lockWaitMilliseconds = defaultLockWaitMilliseconds }: SuperviseParams = {}): Promise<number> {
  const log = agentLog(runtime, spec.name);
  const directory = sessionsDirectory(runtime);
  const record = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    handle: runtime.terminal.currentHandle(process.env),
  };

  if (!(await waitForSession(directory, spec.name, record, lockWaitMilliseconds))) {
    appendLog(log, "not started: another session of this agent is still running");
    return 1;
  }

  try {
    return await runAgent(spec, runtime, log);
  } catch (error) {
    appendLog(log, `failed: ${describeError(error)}`);
    return 1;
  } finally {
    releaseSession(directory, spec.name, record.pid);
  }
}

const defaultLockWaitMilliseconds = 30 * secondMilliseconds;
const lockPollMilliseconds = 250;

async function waitForSession(directory: string, name: string, record: SessionRecord, lockWaitMilliseconds: number): Promise<boolean> {
  const deadline = Date.now() + lockWaitMilliseconds;
  while (!acquireSession(directory, name, record)) {
    if (Date.now() >= deadline) {
      return false;
    }

    await delay(lockPollMilliseconds);
  }

  return true;
}

async function runAgent(spec: AgentSpec, runtime: Runtime, log: string): Promise<number> {
  const [executable, ...commandArguments] = runtime.runner.command(instructionsPrompt(spec), spec.runnerOptions);
  if (!executable) {
    throw new Error("the runner produced an empty command");
  }

  appendLog(log, `started (${spec.lifetime})`);
  const child = spawn(executable, commandArguments, { cwd: spec.cwd, stdio: "inherit" });
  const releaseSignals = relaySignals(child);

  try {
    return await waitForExit(child, log);
  } finally {
    releaseSignals();
  }
}

const forwardedSignals: NodeJS.Signals[] = ["SIGTERM", "SIGHUP"];

function relaySignals(child: ChildProcess): () => void {
  const forwardSignal = (signal: NodeJS.Signals) => child.kill(signal);
  const ignoreInterrupt = () => {};

  for (const signal of forwardedSignals) {
    process.on(signal, forwardSignal);
  }
  process.on("SIGINT", ignoreInterrupt);

  return () => {
    for (const signal of forwardedSignals) {
      process.off(signal, forwardSignal);
    }
    process.off("SIGINT", ignoreInterrupt);
  };
}

function waitForExit(child: ChildProcess, log: string): Promise<number> {
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => {
      appendLog(log, `exited with ${signal ? `signal ${signal}` : `code ${code}`}`);
      resolveExit(code ?? 1);
    });
  });
}
