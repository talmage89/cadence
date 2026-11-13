import { isDueSince } from "./cron.ts";
import { dayMilliseconds } from "./duration.ts";
import type { AgentSpec } from "./spec.ts";
import type { AgentState } from "./state.ts";

export const ScheduleDecision = { Register: "register", Disabled: "disabled", NotDue: "not-due", Due: "due" } as const;
export type ScheduleDecision = (typeof ScheduleDecision)[keyof typeof ScheduleDecision];

export const lookbackMilliseconds = 7 * dayMilliseconds;

export function decideSchedule(spec: AgentSpec, agentState: AgentState | undefined, nowMilliseconds: number): ScheduleDecision {
  const isRunNowPending = spec.runNow && agentState?.hasHonoredRunNow !== true;
  if (spec.enabled && isRunNowPending) {
    return ScheduleDecision.Due;
  }

  if (!agentState) {
    return ScheduleDecision.Register;
  }

  if (!spec.enabled) {
    return ScheduleDecision.Disabled;
  }

  const sinceMilliseconds = Math.max(Date.parse(agentState.lastChecked), nowMilliseconds - lookbackMilliseconds);
  return isDueSince(spec.schedule, sinceMilliseconds, nowMilliseconds) ? ScheduleDecision.Due : ScheduleDecision.NotDue;
}
