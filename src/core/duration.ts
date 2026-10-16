import { z } from "zod";

export const secondMilliseconds = 1_000;
export const minuteMilliseconds = 60 * secondMilliseconds;
export const hourMilliseconds = 60 * minuteMilliseconds;
export const dayMilliseconds = 24 * hourMilliseconds;

const DurationUnit = { Second: "s", Minute: "m", Hour: "h", Day: "d" } as const;
type DurationUnit = (typeof DurationUnit)[keyof typeof DurationUnit];

export const durationSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d*[smhd]$/, { error: (issue) => `invalid duration "${String(issue.input)}": use a whole number with s, m, h, or d, like 45m` })
  .transform(toMilliseconds);

function toMilliseconds(text: string): number {
  const unit = z.enum(DurationUnit).parse(text.slice(-1));
  return Number(text.slice(0, -1)) * unitMilliseconds[unit];
}

const unitMilliseconds: Record<DurationUnit, number> = {
  [DurationUnit.Second]: secondMilliseconds,
  [DurationUnit.Minute]: minuteMilliseconds,
  [DurationUnit.Hour]: hourMilliseconds,
  [DurationUnit.Day]: dayMilliseconds,
};
