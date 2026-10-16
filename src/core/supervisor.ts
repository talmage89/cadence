import { type ChildProcess, spawn } from "node:child_process";
import { secondMilliseconds } from "./duration.ts";
import { appendLog } from "./log.ts";
import { agentLog, type Runtime, sessionsDirectory } from "./runtime.ts";
import { acquireSession, releaseSession } from "./session.ts";
import { type AgentSpec, instructionsPrompt, type Lifetime, LifetimeKind } from "./spec.ts";
import { describeError } from "./validation.ts";

export const killGraceMilliseconds = 10 * secondMilliseconds;

export async function supervise(spec: AgentSpec, runtime: Runtime): Promise<number> {
  const log = agentLog(runtime, spec.name);
  const directory = sessionsDirectory(runtime);
  const record = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    handle: runtime.terminal.currentHandle(process.env),
  };

  if (!acquireSession(directory, spec.name, record)) {
    appendLog(log, "not started: another session of this agent is running");
    return 1;
  }

  try {
    return await runAgent(spec, runtime, log);
  } catch (error) {
    appendLog(log, `failed: ${describeError(error)}`);
    return 1;
  } finally {
    releaseSession(directory, spec.name, record.pid);
    closeTerminalSession(runtime, record.handle, log);
  }
}

function closeTerminalSession(runtime: Runtime, handle: unknown, log: string): void {
  if (handle === null) {
    return;
  }

  try {
    runtime.terminal.close(handle);
  } catch (error) {
    appendLog(log, `could not close the terminal session: ${describeError(error)}`);
  }
}

async function runAgent(spec: AgentSpec, runtime: Runtime, log: string): Promise<number> {
  const [executable, ...commandArguments] = runtime.runner.command(instructionsPrompt(spec), spec.runnerOptions);
  if (!executable) {
    throw new Error("the runner produced an empty command");
  }

  appendLog(log, `started (${spec.lifetime.kind})`);
  const child = spawn(executable, commandArguments, { cwd: spec.cwd, stdio: "inherit" });
  const releaseSignals = relaySignals(child);
  const cancelTimeout = enforceLifetime(child, spec.lifetime, log);

  try {
    return await waitForExit(child, log);
  } finally {
    cancelTimeout();
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

function enforceLifetime(child: ChildProcess, lifetime: Lifetime, log: string): () => void {
  if (lifetime.kind === LifetimeKind.Resident) {
    return () => {};
  }

  const { timeoutMilliseconds } = lifetime;
  let killTimer: NodeJS.Timeout | undefined;
  const timeoutTimer = setTimeout(() => {
    appendLog(log, `timed out after ${timeoutMilliseconds}ms`);
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMilliseconds);
  }, timeoutMilliseconds);

  return () => {
    clearTimeout(timeoutTimer);
    clearTimeout(killTimer);
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
