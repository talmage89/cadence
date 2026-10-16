import { existsSync } from "node:fs";
import { floorToMinute } from "./cron.ts";
import { LaunchOutcome, launch } from "./launcher.ts";
import { appendLog } from "./log.ts";
import { dispatchLog, type Runtime, stateFile } from "./runtime.ts";
import { decideSchedule, ScheduleDecision } from "./schedule-decision.ts";
import { type AgentSpec, loadSpecs, SpecLoadKind } from "./spec.ts";
import { type AgentState, type DispatchState, loadState, saveState } from "./state.ts";
import { describeError } from "./validation.ts";

interface Tick {
  runtime: Runtime;
  now: Date;
  checkedAt: string;
  isTerminalAvailable: () => boolean;
}

export function dispatch(runtime: Runtime, now: Date = new Date()): void {
  if (!existsSync(runtime.agentsDirectory)) {
    return;
  }

  const state = loadState(stateFile(runtime));
  if (!passesGates(runtime, state, now)) {
    saveState(stateFile(runtime), state);
    return;
  }

  const tick: Tick = {
    runtime,
    now,
    checkedAt: new Date(floorToMinute(now.getTime())).toISOString(),
    isTerminalAvailable: memoize(() => runtime.terminal.isAvailable()),
  };

  for (const load of loadSpecs(runtime.agentsDirectory, runtime)) {
    if (load.kind === SpecLoadKind.Invalid) {
      const previous = state.agents[load.name];
      state.agents[load.name] = recordError(tick, load.name, { ...previous, lastChecked: tick.checkedAt }, load.error);
      continue;
    }

    state.agents[load.spec.name] = advanceAgent(tick, load.spec, state.agents[load.spec.name]);
  }

  saveState(stateFile(runtime), state);
}

function passesGates(runtime: Runtime, state: DispatchState, now: Date): boolean {
  for (const gate of runtime.gates) {
    const result = gate.check(state.gates[gate.key], now);
    state.gates[gate.key] = result.memory;
    if (!result.ready) {
      return false;
    }
  }

  return true;
}

function memoize(compute: () => boolean): () => boolean {
  let cached: boolean | undefined;
  return () => (cached ??= compute());
}

function advanceAgent(tick: Tick, spec: AgentSpec, agentState: AgentState | undefined): AgentState {
  const decision = decideSchedule(spec, agentState, tick.now.getTime());
  if (decision !== ScheduleDecision.Due || !agentState) {
    return markChecked(tick, agentState);
  }

  if (!tick.isTerminalAvailable()) {
    return agentState;
  }

  try {
    const outcome = launch(spec, tick.runtime);
    appendLog(dispatchLog(tick.runtime), `${outcome} ${spec.name}`, tick.now);

    const checkedState = markChecked(tick, agentState);
    return outcome === LaunchOutcome.Busy ? checkedState : { ...checkedState, lastStarted: tick.now.toISOString() };
  } catch (error) {
    return recordError(tick, spec.name, agentState, describeError(error));
  }
}

function markChecked(tick: Tick, agentState: AgentState | undefined): AgentState {
  const checkedState: AgentState = { lastChecked: tick.checkedAt };
  if (agentState?.lastStarted) {
    checkedState.lastStarted = agentState.lastStarted;
  }

  return checkedState;
}

function recordError(tick: Tick, name: string, agentState: AgentState, message: string): AgentState {
  if (agentState.lastError !== message) {
    appendLog(dispatchLog(tick.runtime), `failed ${name}: ${message}`, tick.now);
  }

  return { ...agentState, lastError: message };
}
