import { spawn } from "node:child_process";
import { appendLog } from "./log.ts";
import { agentLog, type Runtime, sessionsDirectory } from "./runtime.ts";
import { acquireSession, releaseSession } from "./session.ts";
import { type AgentSpec, instructionsPrompt } from "./spec.ts";

export const killGraceMilliseconds = 10_000;

const forwardedSignals: NodeJS.Signals[] = ["SIGTERM", "SIGHUP"];

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  return signal ? `signal ${signal}` : `code ${code}`;
}

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
    const [executable, ...commandArguments] = runtime.runner.command(instructionsPrompt(spec), spec.runnerOptions);
    if (!executable) throw new Error("the runner produced an empty command");

    appendLog(log, `started (${spec.lifetime.kind})`);
    const child = spawn(executable, commandArguments, { cwd: spec.cwd, stdio: "inherit" });

    const forwardSignal = (signal: NodeJS.Signals) => child.kill(signal);
    const ignoreInterrupt = () => {};
    for (const signal of forwardedSignals) process.on(signal, forwardSignal);
    process.on("SIGINT", ignoreInterrupt);

    const timers: NodeJS.Timeout[] = [];
    if (spec.lifetime.kind === "bounded") {
      const { timeoutMilliseconds } = spec.lifetime;
      timers.push(
        setTimeout(() => {
          appendLog(log, `timed out after ${timeoutMilliseconds}ms`);
          child.kill("SIGTERM");
          timers.push(setTimeout(() => child.kill("SIGKILL"), killGraceMilliseconds));
        }, timeoutMilliseconds),
      );
    }

    const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", (code, signal) => {
        appendLog(log, `exited with ${describeExit(code, signal)}`);
        resolveExit(code ?? 1);
      });
    });

    for (const timer of timers) clearTimeout(timer);
    for (const signal of forwardedSignals) process.off(signal, forwardSignal);
    process.off("SIGINT", ignoreInterrupt);
    return exitCode;
  } catch (error) {
    appendLog(log, `failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    releaseSession(directory, spec.name, record.pid);
  }
}
