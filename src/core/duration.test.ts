import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { durationSchema } from "./duration.ts";

describe("durationSchema", () => {
  it("should read seconds, minutes, hours, and days", () => {
    assert.equal(durationSchema.parse("90s"), 90_000);
    assert.equal(durationSchema.parse("45m"), 2_700_000);
    assert.equal(durationSchema.parse("10h"), 36_000_000);
    assert.equal(durationSchema.parse("2d"), 172_800_000);
  });

  it("should tolerate surrounding whitespace", () => {
    assert.equal(durationSchema.parse(" 5m "), 300_000);
  });

  it("should explain the expected format", () => {
    const result = durationSchema.safeParse("45");

    assert.match(result.error?.issues[0]?.message ?? "", /invalid duration "45": use a whole number with s, m, h, or d/);
  });

  for (const text of ["45", "m", "1.5h", "-5m", "5 m", "5w", "0m", "05m", ""]) {
    it(`should reject "${text}"`, () => {
      assert.equal(durationSchema.safeParse(text).success, false);
    });
  }
});
