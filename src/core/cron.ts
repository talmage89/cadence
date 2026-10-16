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

const minuteMilliseconds = 60_000;

const fieldBounds: FieldBounds[] = [
  { minimum: 0, maximum: 59 },
  { minimum: 0, maximum: 23 },
  { minimum: 1, maximum: 31 },
  { minimum: 1, maximum: 12 },
  { minimum: 0, maximum: 7 },
];

function expandField(expression: string, { minimum, maximum }: FieldBounds): Set<number> {
  const values = new Set<number>();

  for (const part of expression.split(",")) {
    const [rangeText = "", stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);

    let start: number;
    let end: number;
    if (rangeText === "*") {
      start = minimum;
      end = maximum;
    } else if (rangeText.includes("-")) {
      [start = Number.NaN, end = Number.NaN] = rangeText.split("-").map(Number);
    } else {
      start = Number(rangeText);
      end = stepText === undefined ? start : maximum;
    }

    const isValid =
      rangeText !== "" &&
      [start, end, step].every(Number.isInteger) &&
      step > 0 &&
      start >= minimum &&
      end <= maximum &&
      start <= end;
    if (!isValid) throw new Error(`invalid cron field "${expression}"`);

    for (let value = start; value <= end; value += step) values.add(value);
  }

  return values;
}

export function parseSchedule(expression: string): Schedule {
  const fieldExpressions = expression.trim().split(/\s+/);
  if (fieldExpressions.length !== 5) throw new Error(`schedule "${expression}" needs five fields`);

  const [minutes, hours, daysOfMonth, months, daysOfWeek] = fieldExpressions.map((fieldExpression, index) =>
    expandField(fieldExpression, fieldBounds[index] as FieldBounds),
  ) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  if (daysOfWeek.has(7)) daysOfWeek.add(0);

  return {
    expression,
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    isDayOfMonthRestricted: fieldExpressions[2] !== "*",
    isDayOfWeekRestricted: fieldExpressions[4] !== "*",
  };
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

export function isDueSince(schedule: Schedule, sinceMilliseconds: number, nowMilliseconds: number): boolean {
  const firstMinute = Math.floor(sinceMilliseconds / minuteMilliseconds) * minuteMilliseconds + minuteMilliseconds;

  for (let minute = firstMinute; minute <= nowMilliseconds; minute += minuteMilliseconds) {
    if (scheduleMatches(schedule, new Date(minute))) return true;
  }
  return false;
}
