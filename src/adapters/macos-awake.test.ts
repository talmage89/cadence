import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { macosAwake, type WakeProbe } from "./macos-awake.ts";

const now = new Date("2026-10-16T15:00:00.000Z");
const minutesAgo = (minutes: number) => now.getTime() - minutes * 60_000;

function probe(isFullyAwake: boolean, lastWake: number): WakeProbe {
  return { isFullyAwake: () => isFullyAwake, lastWakeMilliseconds: () => lastWake };
}

describe("macosAwake", () => {
  it("is not ready and forgets its start while the Mac is not fully awake", () => {
    const gate = macosAwake({ settleMinutes: 5, probe: probe(false, minutesAgo(60)) });
    assert.deepEqual(gate.check({ fullyAwakeSince: new Date(minutesAgo(30)).toISOString() }, now), {
      ready: false,
      memory: { fullyAwakeSince: null },
    });
  });

  it("starts counting at the first fully awake sighting", () => {
    const gate = macosAwake({ settleMinutes: 5, probe: probe(true, minutesAgo(60)) });
    assert.deepEqual(gate.check(undefined, now), { ready: false, memory: { fullyAwakeSince: now.toISOString() } });
  });

  it("is ready once awake for the settle period", () => {
    const gate = macosAwake({ settleMinutes: 5, probe: probe(true, minutesAgo(60)) });
    assert.equal(gate.check({ fullyAwakeSince: new Date(minutesAgo(5)).toISOString() }, now).ready, true);
  });

  it("restarts the count after a wake that came later", () => {
    const gate = macosAwake({ settleMinutes: 5, probe: probe(true, minutesAgo(2)) });
    assert.deepEqual(gate.check({ fullyAwakeSince: new Date(minutesAgo(30)).toISOString() }, now), {
      ready: false,
      memory: { fullyAwakeSince: new Date(minutesAgo(2)).toISOString() },
    });
  });

  it("ignores memory it does not recognize", () => {
    const gate = macosAwake({ settleMinutes: 0, probe: probe(true, 0) });
    assert.deepEqual(gate.check("garbage", now), { ready: true, memory: { fullyAwakeSince: now.toISOString() } });
  });
});
