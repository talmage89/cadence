import { existsSync } from "node:fs";
import { decideSchedule } from "./decide.ts";
import { launch } from "./launch.ts";
import { appendLog } from "./log.ts";
import { dispatchLog, type Runtime, stateFile } from "./runtime.ts";
import { loadSpecs, type SpecLoad } from "./spec.ts";
import { type AgentState, type DispatchState, loadState, saveState } from "./state.ts";

const minuteMilliseconds = 60_000;

interface Tick {
  runtime: Runtime;
  now: Date;
  checkedAt: string;
  isTerminalAvailable: () => boolean;
}

function memoize(compute: () => boolean): () => boolean {
  let cached: boolean | undefined;
  return () => (cached ??= compute());
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withError(tick: Tick, name: string, agentState: AgentState, message: string): AgentState {
  if (agentState.lastError !== message) appendLog(dispatchLog(tick.runtime), `failed ${name}: ${message}`, tick.now);
  return { ...agentState, lastError: message };
}

function checked(tick: Tick, agentState: AgentState | undefined): AgentState {
  const next: AgentState = { lastChecked: tick.checkedAt };
  if (agentState?.lastStarted) next.lastStarted = agentState.lastStarted;
  return next;
}

function advanceAgent(tick: Tick, load: SpecLoad, agentState: AgentState | undefined): AgentState {
  if (load.kind === "invalid") {
    return withError(tick, load.name, { ...agentState, lastChecked: tick.checkedAt }, load.error);
  }

  const { spec } = load;
  const decision = decideSchedule(spec, agentState, tick.now.getTime());
  if (decision.kind !== "due" || !agentState) return checked(tick, agentState);
  if (!tick.isTerminalAvailable()) return agentState;

  try {
    const outcome = launch(spec, tick.runtime);
    appendLog(dispatchLog(tick.runtime), `${outcome.kind} ${spec.name}`, tick.now);
    const next = checked(tick, agentState);
    return outcome.kind === "busy" ? next : { ...next, lastStarted: tick.now.toISOString() };
  } catch (error) {
    return withError(tick, spec.name, agentState, describeError(error));
  }
}

function passesGates(runtime: Runtime, state: DispatchState, now: Date): boolean {
  for (const gate of runtime.gates) {
    const result = gate.check(state.gates[gate.key], now);
    state.gates[gate.key] = result.memory;
    if (!result.ready) return false;
  }
  return true;
}

export function dispatch(runtime: Runtime, now: Date = new Date()): void {
  if (!existsSync(runtime.agentsDirectory)) return;

  const state = loadState(stateFile(runtime));
  if (!passesGates(runtime, state, now)) {
    saveState(stateFile(runtime), state);
    return;
  }

  const tick: Tick = {
    runtime,
    now,
    checkedAt: new Date(Math.floor(now.getTime() / minuteMilliseconds) * minuteMilliseconds).toISOString(),
    isTerminalAvailable: memoize(() => runtime.terminal.isAvailable()),
  };

  for (const load of loadSpecs(runtime.agentsDirectory, runtime)) {
    const name = load.kind === "loaded" ? load.spec.name : load.name;
    state.agents[name] = advanceAgent(tick, load, state.agents[name]);
  }

  saveState(stateFile(runtime), state);
}
