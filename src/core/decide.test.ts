import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeTerminal, nodeRunner } from "../testing/fakes.ts";
import { decideSchedule, lookbackMilliseconds } from "./decide.ts";
import { parseSpec } from "./spec.ts";

const context = { runner: nodeRunner(), terminal: fakeTerminal(), defaultCwd: "/work" };

function spec(frontmatter: string) {
  return parseSpec("agent", "/agents/agent.md", `---\n${frontmatter}\n---\n`, context);
}

const everyMinute = spec('schedule: "* * * * *"');
const now = new Date(2026, 9, 16, 9, 0).getTime();
const minuteAgo = new Date(now - 60_000).toISOString();

describe("decideSchedule", () => {
  it("registers an agent seen for the first time", () => {
    assert.deepEqual(decideSchedule(everyMinute, undefined, now), { kind: "register" });
  });

  it("skips a disabled agent", () => {
    assert.deepEqual(decideSchedule(spec('schedule: "* * * * *"\nenabled: false'), { lastChecked: minuteAgo }, now), { kind: "disabled" });
  });

  it("is due when the schedule matched since the last check", () => {
    assert.deepEqual(decideSchedule(everyMinute, { lastChecked: minuteAgo }, now), { kind: "due" });
  });

  it("is not due when already checked this minute", () => {
    assert.deepEqual(decideSchedule(everyMinute, { lastChecked: new Date(now).toISOString() }, now), { kind: "not-due" });
  });

  it("is not due when the schedule did not match", () => {
    const tenPm = spec('schedule: "0 22 * * *"');
    assert.deepEqual(decideSchedule(tenPm, { lastChecked: minuteAgo }, now), { kind: "not-due" });
  });

  it("looks back no further than the lookback window", () => {
    const yearly = spec('schedule: "0 9 1 1 *"');
    const longAgo = new Date(now - lookbackMilliseconds * 60).toISOString();
    assert.deepEqual(decideSchedule(yearly, { lastChecked: longAgo }, now), { kind: "not-due" });
  });
});
