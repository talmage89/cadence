import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { floorToMinute, isDueSince, scheduleMatches, scheduleSchema } from "./cron.ts";

function localDate(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

describe("scheduleSchema", () => {
  it("should expand wildcards to the full range", () => {
    const schedule = scheduleSchema.parse("* * * * *");

    assert.equal(schedule.minutes.size, 60);
    assert.equal(schedule.hours.size, 24);
    assert.equal(schedule.daysOfMonth.size, 31);
    assert.equal(schedule.months.size, 12);
  });

  it("should expand lists, ranges, and steps", () => {
    const schedule = scheduleSchema.parse("0,30 9-17 */10 1-12/3 1-5");

    assert.deepEqual([...schedule.minutes], [0, 30]);
    assert.deepEqual([...schedule.hours], [9, 10, 11, 12, 13, 14, 15, 16, 17]);
    assert.deepEqual([...schedule.daysOfMonth], [1, 11, 21, 31]);
    assert.deepEqual([...schedule.months], [1, 4, 7, 10]);
    assert.deepEqual([...schedule.daysOfWeek], [1, 2, 3, 4, 5]);
  });

  it("should read a stepped single value as running to the field maximum", () => {
    assert.deepEqual([...scheduleSchema.parse("50/5 * * * *").minutes], [50, 55]);
  });

  it("should treat day-of-week 7 as Sunday", () => {
    assert.ok(scheduleSchema.parse("0 0 * * 7").daysOfWeek.has(0));
  });

  it("should record which day fields are restricted", () => {
    const bothRestricted = scheduleSchema.parse("0 0 1 * 1");
    const neitherRestricted = scheduleSchema.parse("0 0 * * *");

    assert.equal(bothRestricted.isDayOfMonthRestricted, true);
    assert.equal(bothRestricted.isDayOfWeekRestricted, true);
    assert.equal(neitherRestricted.isDayOfWeekRestricted, false);
  });

  it("should keep the original expression", () => {
    assert.equal(scheduleSchema.parse("30 6 * * 1-5").expression, "30 6 * * 1-5");
  });

  it("should report a wrong field count", () => {
    const result = scheduleSchema.safeParse("* * * *");

    assert.equal(result.success, false);
    assert.match(result.error?.issues[0]?.message ?? "", /needs 5 fields/);
  });

  for (const expression of ["* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "5-1 * * * *", "*/0 * * * *", "a * * * *", ", * * * *"]) {
    it(`should reject "${expression}"`, () => {
      assert.equal(scheduleSchema.safeParse(expression).success, false);
    });
  }
});

describe("scheduleMatches", () => {
  it("should match on minute, hour, and month", () => {
    const schedule = scheduleSchema.parse("30 6 * 10 *");

    assert.equal(scheduleMatches(schedule, localDate(2026, 10, 15, 6, 30)), true);
    assert.equal(scheduleMatches(schedule, localDate(2026, 10, 15, 6, 31)), false);
    assert.equal(scheduleMatches(schedule, localDate(2026, 11, 15, 6, 30)), false);
  });

  it("should require both day fields when only one is restricted", () => {
    const weekdays = scheduleSchema.parse("0 9 * * 1-5");

    assert.equal(scheduleMatches(weekdays, localDate(2026, 10, 16, 9)), true);
    assert.equal(scheduleMatches(weekdays, localDate(2026, 10, 17, 9)), false);
  });

  it("should accept either day field when both are restricted", () => {
    const firstOrMonday = scheduleSchema.parse("0 9 1 * 1");

    assert.equal(scheduleMatches(firstOrMonday, localDate(2026, 10, 1, 9)), true);
    assert.equal(scheduleMatches(firstOrMonday, localDate(2026, 10, 19, 9)), true);
    assert.equal(scheduleMatches(firstOrMonday, localDate(2026, 10, 20, 9)), false);
  });
});

describe("isDueSince", () => {
  const nineDaily = scheduleSchema.parse("0 9 * * *");

  it("should be due when a matching minute falls after since and at or before now", () => {
    assert.equal(isDueSince(nineDaily, localDate(2026, 10, 16, 8, 59).getTime(), localDate(2026, 10, 16, 9, 0).getTime()), true);
  });

  it("should not count the since minute itself", () => {
    assert.equal(isDueSince(nineDaily, localDate(2026, 10, 16, 9, 0).getTime(), localDate(2026, 10, 16, 9, 5).getTime()), false);
  });

  it("should not be due when no minute in the window matches", () => {
    assert.equal(isDueSince(nineDaily, localDate(2026, 10, 16, 9, 1).getTime(), localDate(2026, 10, 16, 23, 59).getTime()), false);
  });

  it("should catch up a match missed during a long gap", () => {
    assert.equal(isDueSince(nineDaily, localDate(2026, 10, 15, 10).getTime(), localDate(2026, 10, 16, 12).getTime()), true);
  });

  it("should floor a since that is not on a minute boundary", () => {
    const halfPastEightFiftyNine = localDate(2026, 10, 16, 8, 59).getTime() + 30_000;

    assert.equal(isDueSince(nineDaily, halfPastEightFiftyNine, localDate(2026, 10, 16, 9, 0).getTime()), true);
  });
});

describe("floorToMinute", () => {
  it("should drop seconds and milliseconds", () => {
    const withSeconds = localDate(2026, 10, 16, 9, 0).getTime() + 59_999;

    assert.equal(floorToMinute(withSeconds), localDate(2026, 10, 16, 9, 0).getTime());
  });
});
