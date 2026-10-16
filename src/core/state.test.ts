import assert from "node:assert/strict";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { temporaryDirectory } from "#testing/fakes.ts";
import { type DispatchState, loadState, saveState } from "./state.ts";

describe("loadState", () => {
  it("should start empty when there is no state file", () => {
    assert.deepEqual(loadState(join(temporaryDirectory(), "dispatch.json")), { gates: {}, agents: {} });
  });

  it("should name the file when its contents are malformed", () => {
    const file = join(temporaryDirectory(), "dispatch.json");
    writeFileSync(file, '{"gates":{},"agents":{"agent":{}}}');

    assert.throws(() => loadState(file), new RegExp(`state file ${file} is malformed: agents\\.agent\\.lastChecked`));
  });
});

describe("saveState", () => {
  it("should round-trip through loadState without leaving temporary files", () => {
    const directory = join(temporaryDirectory(), "nested");
    const file = join(directory, "dispatch.json");
    const state: DispatchState = {
      gates: { awake: { since: "2026-10-16T09:00:00.000Z" } },
      agents: { agent: { lastChecked: "2026-10-16T09:00:00.000Z", lastError: "boom" } },
    };

    saveState(file, state);

    assert.deepEqual(loadState(file), state);
    assert.deepEqual(readdirSync(directory), ["dispatch.json"]);
  });
});
