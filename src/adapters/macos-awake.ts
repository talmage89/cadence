import { execFileSync } from "node:child_process";
import { z } from "zod";
import { minuteMilliseconds, secondMilliseconds } from "#core/duration.ts";
import type { Gate } from "#core/ports.ts";
import { parseOrThrow } from "#core/validation.ts";

export interface WakeProbe {
  isFullyAwake(): boolean;
  lastWakeMilliseconds(): number;
}

export interface MacosAwakeParams {
  settleMinutes: number;
  probe?: WakeProbe;
}

export function macosAwake({ settleMinutes, probe = systemProbe }: MacosAwakeParams): Gate {
  const settleMilliseconds = settleMinutes * minuteMilliseconds;

  return {
    key: "macos-awake",

    check(memory, now) {
      if (!probe.isFullyAwake()) {
        return { ready: false, memory: { fullyAwakeSince: null } };
      }

      const previous = memorySchema.safeParse(memory);
      const previousSince = previous.success && previous.data.fullyAwakeSince !== null ? Date.parse(previous.data.fullyAwakeSince) : now.getTime();
      const fullyAwakeSince = Math.max(previousSince, probe.lastWakeMilliseconds());

      return {
        ready: now.getTime() - fullyAwakeSince >= settleMilliseconds,
        memory: { fullyAwakeSince: new Date(fullyAwakeSince).toISOString() },
      };
    },
  };
}

const memorySchema = z.object({ fullyAwakeSince: z.string().nullable() });

const fullyAwakePattern = /Capabilities are:.*\bGraphics\b/;

const wakeTimeSchema = z
  .string()
  .regex(/sec = \d+/, { error: "kern.waketime has no seconds field" })
  .transform((output) => Number(output.match(/sec = (\d+)/)?.[1]) * secondMilliseconds);

const systemProbe: WakeProbe = {
  isFullyAwake() {
    return fullyAwakePattern.test(execFileSync("/usr/bin/pmset", ["-g", "systemstate"], { encoding: "utf8" }));
  },
  lastWakeMilliseconds() {
    return parseOrThrow(wakeTimeSchema, execFileSync("/usr/sbin/sysctl", ["-n", "kern.waketime"], { encoding: "utf8" }));
  },
};
