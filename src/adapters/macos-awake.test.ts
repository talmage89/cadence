import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { minuteMilliseconds } from "#core/duration.ts";
import { macosAwake, type WakeProbe } from "./macos-awake.ts";

const now = new Date("2026-10-16T15:00:00.000Z");

function minutesAgo(minutes: number): number {
  return now.getTime() - minutes * minuteMilliseconds;
}

function isoMinutesAgo(minutes: number): string {
  return new Date(minutesAgo(minutes)).toISOString();
}

function probe(isFullyAwake: boolean, lastWake: number): WakeProbe {
  return { isFullyAwake: () => isFullyAwake, lastWakeMilliseconds: () => lastWake };
}

describe("macosAwake", () => {
  it("should not be ready, and forget its start, while the Mac is not fully awake", () => {
    const gate = macosAwake({ settleMinutes: 5, probe: probe(false, minutesAgo(60)) });

    const result = gate.check({ fullyAwakeSince: isoMinutesAgo(30) }, now);

    assert.deepEqual(result, { ready: false, memory: { fullyAwakeSince: null } });
  });

  it("should start counting at the first fully awake sighting", () => {
    const gate = macosAwake({ settleMinutes: 5, probe: probe(true, minutesAgo(60)) });

    assert.deepEqual(gate.check(undefined, now), { ready: false, memory: { fullyAwakeSince: now.toISOString() } });
  });

  it("should be ready once awake for the settle period", () => {
    const gate = macosAwake({ settleMinutes: 5, probe: probe(true, minutesAgo(60)) });

    assert.equal(gate.check({ fullyAwakeSince: isoMinutesAgo(5) }, now).ready, true);
  });

  it("should restart the count after a later wake", () => {
    const gate = macosAwake({ settleMinutes: 5, probe: probe(true, minutesAgo(2)) });

    const result = gate.check({ fullyAwakeSince: isoMinutesAgo(30) }, now);

    assert.deepEqual(result, { ready: false, memory: { fullyAwakeSince: isoMinutesAgo(2) } });
  });

  it("should ignore memory it does not recognize", () => {
    const gate = macosAwake({ settleMinutes: 0, probe: probe(true, 0) });

    assert.deepEqual(gate.check("garbage", now), { ready: true, memory: { fullyAwakeSince: now.toISOString() } });
  });
});
