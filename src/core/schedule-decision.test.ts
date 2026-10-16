import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeTerminal, nodeRunner } from "#testing/fakes.ts";
import { minuteMilliseconds } from "./duration.ts";
import { decideSchedule, lookbackMilliseconds, ScheduleDecision } from "./schedule-decision.ts";
import { type AgentSpec, parseSpec } from "./spec.ts";

const context = { runner: nodeRunner(), terminal: fakeTerminal(), defaultCwd: "/work" };

function spec(frontmatter: string): AgentSpec {
  return parseSpec({ name: "agent", file: "/agents/agent.md", text: `---\n${frontmatter}\n---\n` }, context);
}

const everyMinute = spec('schedule: "* * * * *"');
const now = new Date(2026, 9, 16, 9, 0).getTime();
const minuteAgo = new Date(now - minuteMilliseconds).toISOString();

describe("decideSchedule", () => {
  it("should register an agent seen for the first time", () => {
    assert.equal(decideSchedule(everyMinute, undefined, now), ScheduleDecision.Register);
  });

  it("should skip a disabled agent", () => {
    const disabled = spec('schedule: "* * * * *"\nenabled: false');

    assert.equal(decideSchedule(disabled, { lastChecked: minuteAgo }, now), ScheduleDecision.Disabled);
  });

  it("should be due when the schedule matched since the last check", () => {
    assert.equal(decideSchedule(everyMinute, { lastChecked: minuteAgo }, now), ScheduleDecision.Due);
  });

  it("should not be due when already checked this minute", () => {
    assert.equal(decideSchedule(everyMinute, { lastChecked: new Date(now).toISOString() }, now), ScheduleDecision.NotDue);
  });

  it("should not be due when the schedule did not match", () => {
    const tenPm = spec('schedule: "0 22 * * *"');

    assert.equal(decideSchedule(tenPm, { lastChecked: minuteAgo }, now), ScheduleDecision.NotDue);
  });

  it("should look back no further than the lookback window", () => {
    const yearly = spec('schedule: "0 9 1 1 *"');
    const longAgo = new Date(now - lookbackMilliseconds * 60).toISOString();

    assert.equal(decideSchedule(yearly, { lastChecked: longAgo }, now), ScheduleDecision.NotDue);
  });
});
