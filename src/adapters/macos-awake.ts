import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { Gate } from "../core/ports.ts";

export interface WakeProbe {
  isFullyAwake(): boolean;
  lastWakeMilliseconds(): number;
}

export interface MacosAwakeSettings {
  settleMinutes: number;
  probe?: WakeProbe;
}

const memorySchema = z.object({ fullyAwakeSince: z.string().nullable() });

const systemProbe: WakeProbe = {
  isFullyAwake() {
    const systemState = execFileSync("/usr/bin/pmset", ["-g", "systemstate"], { encoding: "utf8" });
    return /Capabilities are:.*\bGraphics\b/.test(systemState);
  },
  lastWakeMilliseconds() {
    const wakeTime = execFileSync("/usr/sbin/sysctl", ["-n", "kern.waketime"], { encoding: "utf8" });
    return Number(wakeTime.match(/sec = (\d+)/)?.[1] ?? 0) * 1000;
  },
};

export function macosAwake({ settleMinutes, probe = systemProbe }: MacosAwakeSettings): Gate {
  const settleMilliseconds = settleMinutes * 60_000;

  return {
    key: "macos-awake",

    check(memory, now) {
      if (!probe.isFullyAwake()) return { ready: false, memory: { fullyAwakeSince: null } };

      const previous = memorySchema.safeParse(memory);
      const previousSince = previous.success && previous.data.fullyAwakeSince ? Date.parse(previous.data.fullyAwakeSince) : now.getTime();
      const fullyAwakeSince = Math.max(previousSince, probe.lastWakeMilliseconds());

      return {
        ready: now.getTime() - fullyAwakeSince >= settleMilliseconds,
        memory: { fullyAwakeSince: new Date(fullyAwakeSince).toISOString() },
      };
    },
  };
}
