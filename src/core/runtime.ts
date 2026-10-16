import { join } from "node:path";
import type { Gate, Runner, Terminal } from "./ports.ts";

export interface Runtime {
  agentsDirectory: string;
  stateDirectory: string;
  logDirectory: string;
  defaultCwd: string;
  gates: Gate[];
  terminal: Terminal;
  runner: Runner;
  supervisorCommand: string[];
}

export function stateFile(runtime: Runtime): string {
  return join(runtime.stateDirectory, "dispatch.json");
}

export function sessionsDirectory(runtime: Runtime): string {
  return join(runtime.stateDirectory, "sessions");
}

export function dispatchLog(runtime: Runtime): string {
  return join(runtime.logDirectory, "dispatch.log");
}

export function agentLog(runtime: Runtime, name: string): string {
  return join(runtime.logDirectory, `${name}.log`);
}
