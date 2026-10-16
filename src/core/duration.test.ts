import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDuration } from "./duration.ts";

describe("parseDuration", () => {
  it("reads seconds, minutes, hours, and days", () => {
    assert.equal(parseDuration("90s"), 90_000);
    assert.equal(parseDuration("45m"), 2_700_000);
    assert.equal(parseDuration("10h"), 36_000_000);
    assert.equal(parseDuration("2d"), 172_800_000);
  });

  it("tolerates surrounding whitespace", () => {
    assert.equal(parseDuration(" 5m "), 300_000);
  });

  for (const text of ["45", "m", "1.5h", "-5m", "5 m", "5w", "0m", ""]) {
    it(`rejects "${text}"`, () => {
      assert.throws(() => parseDuration(text));
    });
  }
});
