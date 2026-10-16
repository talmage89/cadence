import { z } from "zod";
import { minuteMilliseconds } from "./duration.ts";

export interface Schedule {
  expression: string;
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  isDayOfMonthRestricted: boolean;
  isDayOfWeekRestricted: boolean;
}

interface FieldBounds {
  minimum: number;
  maximum: number;
}

interface FieldRange {
  start: number;
  end: number;
  step: number;
}

const wildcard = "*";
const sunday = 0;
const alternateSunday = 7;
const fieldCount = 5;

export const scheduleSchema = z.string().transform(toSchedule);

export function isDueSince(schedule: Schedule, sinceMilliseconds: number, nowMilliseconds: number): boolean {
  for (let minute = floorToMinute(sinceMilliseconds) + minuteMilliseconds; minute <= nowMilliseconds; minute += minuteMilliseconds) {
    if (scheduleMatches(schedule, new Date(minute))) {
      return true;
    }
  }

  return false;
}

export function scheduleMatches(schedule: Schedule, date: Date): boolean {
  const dayOfMonthMatches = schedule.daysOfMonth.has(date.getDate());
  const dayOfWeekMatches = schedule.daysOfWeek.has(date.getDay());
  const areBothDaysRestricted = schedule.isDayOfMonthRestricted && schedule.isDayOfWeekRestricted;
  const dayMatches = areBothDaysRestricted ? dayOfMonthMatches || dayOfWeekMatches : dayOfMonthMatches && dayOfWeekMatches;

  return (
    dayMatches &&
    schedule.minutes.has(date.getMinutes()) &&
    schedule.hours.has(date.getHours()) &&
    schedule.months.has(date.getMonth() + 1)
  );
}

export function floorToMinute(milliseconds: number): number {
  return Math.floor(milliseconds / minuteMilliseconds) * minuteMilliseconds;
}

function toSchedule(expression: string, context: z.RefinementCtx<string>): Schedule {
  const fieldTexts = expression.trim().split(/\s+/);
  if (fieldTexts.length !== fieldCount) {
    context.addIssue({ code: "custom", message: `"${expression}" needs ${fieldCount} fields` });
    return z.NEVER;
  }

  const fields = fieldsSchema().safeParse(fieldTexts);
  if (!fields.success) {
    for (const issue of fields.error.issues) {
      context.addIssue({ code: "custom", message: issue.message });
    }
    return z.NEVER;
  }

  const [minutes, hours, daysOfMonth, months, daysOfWeek] = fields.data;
  if (daysOfWeek.has(alternateSunday)) {
    daysOfWeek.add(sunday);
  }

  return {
    expression,
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    isDayOfMonthRestricted: fieldTexts[2] !== wildcard,
    isDayOfWeekRestricted: fieldTexts[4] !== wildcard,
  };
}

function fieldsSchema() {
  return z.tuple([
    fieldSchema({ minimum: 0, maximum: 59 }),
    fieldSchema({ minimum: 0, maximum: 23 }),
    fieldSchema({ minimum: 1, maximum: 31 }),
    fieldSchema({ minimum: 1, maximum: 12 }),
    fieldSchema({ minimum: sunday, maximum: alternateSunday }),
  ]);
}

function fieldSchema(bounds: FieldBounds) {
  return z
    .string()
    .transform((field) => field.split(","))
    .pipe(z.array(fieldPartSchema(bounds)))
    .transform(expandRanges);
}

function fieldPartSchema(bounds: FieldBounds) {
  return z
    .string()
    .regex(/^(?:\*|\d+(?:-\d+)?)(?:\/\d+)?$/, { error: (issue) => `invalid cron field "${String(issue.input)}"` })
    .transform((part) => toRange(part, bounds))
    .refine((range) => isWithinBounds(range, bounds), {
      error: `invalid cron field: a value falls outside ${bounds.minimum}-${bounds.maximum} or a range runs backwards`,
    });
}

function toRange(part: string, { minimum, maximum }: FieldBounds): FieldRange {
  const [rangeText = "", stepText] = part.split("/");
  const step = stepText === undefined ? 1 : Number(stepText);

  if (rangeText === wildcard) {
    return { start: minimum, end: maximum, step };
  }

  if (rangeText.includes("-")) {
    const [startText, endText] = rangeText.split("-");
    return { start: Number(startText), end: Number(endText), step };
  }

  const start = Number(rangeText);
  return { start, end: stepText === undefined ? start : maximum, step };
}

function isWithinBounds({ start, end, step }: FieldRange, { minimum, maximum }: FieldBounds): boolean {
  return step > 0 && start >= minimum && end <= maximum && start <= end;
}

function expandRanges(ranges: FieldRange[]): Set<number> {
  const values = new Set<number>();
  for (const { start, end, step } of ranges) {
    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  return values;
}
