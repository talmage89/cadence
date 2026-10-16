import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { describeError, jsonSchema, parseOrThrow } from "./validation.ts";

describe("parseOrThrow", () => {
  const personSchema = z.object({ name: z.string(), age: z.number() });

  it("should return the parsed value", () => {
    assert.deepEqual(parseOrThrow(personSchema, { name: "Ada", age: 36 }), { name: "Ada", age: 36 });
  });

  it("should throw one readable message naming each failing path", () => {
    assert.throws(() => parseOrThrow(personSchema, { name: 1 }), /^Error: name: .+; age: .+$/);
  });

  it("should leave the path off root-level failures", () => {
    assert.throws(() => parseOrThrow(z.string().min(3, "too short"), "a"), /^Error: too short$/);
  });
});

describe("jsonSchema", () => {
  const countSchema = jsonSchema(z.object({ count: z.number() }));

  it("should parse JSON text and validate the result", () => {
    assert.deepEqual(countSchema.parse('{"count":2}'), { count: 2 });
  });

  it("should reject text that is not JSON", () => {
    const result = countSchema.safeParse("{nope");

    assert.equal(result.success, false);
    assert.match(result.error?.issues[0]?.message ?? "", /^invalid JSON:/);
  });

  it("should reject JSON of the wrong shape", () => {
    assert.equal(countSchema.safeParse('{"count":"two"}').success, false);
  });
});

describe("describeError", () => {
  it("should use an error's message and stringify anything else", () => {
    assert.equal(describeError(new Error("broken")), "broken");
    assert.equal(describeError("plain"), "plain");
  });
});
