import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hangUpTty } from "./tty.ts";

describe("hangUpTty", () => {
  it("should do nothing for a tty no process is attached to", () => {
    assert.doesNotThrow(() => hangUpTty("/dev/ttys999"));
  });
});
