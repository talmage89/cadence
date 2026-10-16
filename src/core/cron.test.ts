import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDueSince, parseSchedule, scheduleMatches } from "./cron.ts";

function localDate(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

describe("parseSchedule", () => {
  it("expands wildcards to the full range", () => {
    const schedule = parseSchedule("* * * * *");
    assert.equal(schedule.minutes.size, 60);
    assert.equal(schedule.hours.size, 24);
    assert.equal(schedule.daysOfMonth.size, 31);
    assert.equal(schedule.months.size, 12);
  });

  it("expands lists, ranges, and steps", () => {
    const schedule = parseSchedule("0,30 9-17 */10 1-12/3 1-5");
    assert.deepEqual([...schedule.minutes], [0, 30]);
    assert.deepEqual([...schedule.hours], [9, 10, 11, 12, 13, 14, 15, 16, 17]);
    assert.deepEqual([...schedule.daysOfMonth], [1, 11, 21, 31]);
    assert.deepEqual([...schedule.months], [1, 4, 7, 10]);
    assert.deepEqual([...schedule.daysOfWeek], [1, 2, 3, 4, 5]);
  });

  it("reads a stepped single value as running to the field maximum", () => {
    assert.deepEqual([...parseSchedule("50/5 * * * *").minutes], [50, 55]);
  });

  it("treats day-of-week 7 as Sunday", () => {
    assert.ok(parseSchedule("0 0 * * 7").daysOfWeek.has(0));
  });

  it("records which day fields are restricted", () => {
    const schedule = parseSchedule("0 0 1 * 1");
    assert.equal(schedule.isDayOfMonthRestricted, true);
    assert.equal(schedule.isDayOfWeekRestricted, true);
    assert.equal(parseSchedule("0 0 * * *").isDayOfWeekRestricted, false);
  });

  it("keeps the original expression", () => {
    assert.equal(parseSchedule("30 6 * * 1-5").expression, "30 6 * * 1-5");
  });

  for (const expression of ["* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "5-1 * * * *", "*/0 * * * *", "a * * * *", ", * * * *"]) {
    it(`rejects "${expression}"`, () => {
      assert.throws(() => parseSchedule(expression));
    });
  }
});

describe("scheduleMatches", () => {
  it("matches on minute, hour, and month", () => {
    const schedule = parseSchedule("30 6 * 10 *");
    assert.equal(scheduleMatches(schedule, localDate(2026, 10, 15, 6, 30)), true);
    assert.equal(scheduleMatches(schedule, localDate(2026, 10, 15, 6, 31)), false);
    assert.equal(scheduleMatches(schedule, localDate(2026, 11, 15, 6, 30)), false);
  });

  it("requires both day fields when only one is restricted", () => {
    const weekdays = parseSchedule("0 9 * * 1-5");
    assert.equal(scheduleMatches(weekdays, localDate(2026, 10, 16, 9)), true);
    assert.equal(scheduleMatches(weekdays, localDate(2026, 10, 17, 9)), false);
  });

  it("accepts either day field when both are restricted", () => {
    const firstOrMonday = parseSchedule("0 9 1 * 1");
    assert.equal(scheduleMatches(firstOrMonday, localDate(2026, 10, 1, 9)), true);
    assert.equal(scheduleMatches(firstOrMonday, localDate(2026, 10, 19, 9)), true);
    assert.equal(scheduleMatches(firstOrMonday, localDate(2026, 10, 20, 9)), false);
  });
});

describe("isDueSince", () => {
  const nineDaily = parseSchedule("0 9 * * *");

  it("is due when a matching minute falls after since and at or before now", () => {
    assert.equal(isDueSince(nineDaily, localDate(2026, 10, 16, 8, 59).getTime(), localDate(2026, 10, 16, 9, 0).getTime()), true);
  });

  it("does not count the since minute itself", () => {
    assert.equal(isDueSince(nineDaily, localDate(2026, 10, 16, 9, 0).getTime(), localDate(2026, 10, 16, 9, 5).getTime()), false);
  });

  it("is not due when no minute in the window matches", () => {
    assert.equal(isDueSince(nineDaily, localDate(2026, 10, 16, 9, 1).getTime(), localDate(2026, 10, 16, 23, 59).getTime()), false);
  });

  it("catches up a match missed during a long gap", () => {
    assert.equal(isDueSince(nineDaily, localDate(2026, 10, 15, 10).getTime(), localDate(2026, 10, 16, 12).getTime()), true);
  });

  it("floors a since that is not on a minute boundary", () => {
    const since = localDate(2026, 10, 16, 8, 59).getTime() + 30_000;
    assert.equal(isDueSince(nineDaily, since, localDate(2026, 10, 16, 9, 0).getTime()), true);
  });
});
