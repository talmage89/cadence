import { isDueSince } from "./cron.ts";
import type { AgentSpec } from "./spec.ts";
import type { AgentState } from "./state.ts";

export type ScheduleDecision = { kind: "register" } | { kind: "disabled" } | { kind: "not-due" } | { kind: "due" };

export const lookbackMilliseconds = 7 * 24 * 60 * 60_000;

export function decideSchedule(spec: AgentSpec, agentState: AgentState | undefined, nowMilliseconds: number): ScheduleDecision {
  if (!agentState) return { kind: "register" };
  if (!spec.enabled) return { kind: "disabled" };

  const sinceMilliseconds = Math.max(Date.parse(agentState.lastChecked), nowMilliseconds - lookbackMilliseconds);
  return isDueSince(spec.schedule, sinceMilliseconds, nowMilliseconds) ? { kind: "due" } : { kind: "not-due" };
}
