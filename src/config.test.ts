import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createEnvironment, defineConfig, repositoryRoot, resolveRuntime } from "./config.ts";
import { fakeTerminal, nodeRunner } from "./testing/fakes.ts";

describe("createEnvironment", () => {
  const environment = createEnvironment({ PRESENT: "value", EMPTY: "" });

  it("returns required values that are set", () => {
    assert.equal(environment.require("PRESENT"), "value");
  });

  it("throws for required values that are missing or empty", () => {
    assert.throws(() => environment.require("MISSING"), /MISSING is not set/);
    assert.throws(() => environment.require("EMPTY"), /EMPTY is not set/);
  });

  it("treats empty optional values as unset", () => {
    assert.equal(environment.optional("EMPTY"), undefined);
    assert.equal(environment.optional("PRESENT"), "value");
  });
});

describe("resolveRuntime", () => {
  const factory = defineConfig((environment) => ({
    agentsDirectory: environment.require("AGENTS"),
    stateDirectory: "~/state",
    logDirectory: "/tmp/logs/../logs",
    defaultCwd: "~",
    gates: [],
    terminal: fakeTerminal(),
    runner: nodeRunner(),
  }));

  it("expands and normalizes every directory", () => {
    const runtime = resolveRuntime(factory, createEnvironment({ AGENTS: "~/agents" }));
    assert.equal(runtime.agentsDirectory, join(homedir(), "agents"));
    assert.equal(runtime.stateDirectory, join(homedir(), "state"));
    assert.equal(runtime.logDirectory, "/tmp/logs");
    assert.equal(runtime.defaultCwd, homedir());
  });

  it("points terminals at this checkout's CLI", () => {
    const runtime = resolveRuntime(factory, createEnvironment({ AGENTS: "/agents" }));
    assert.deepEqual(runtime.supervisorCommand, [process.execPath, join(repositoryRoot, "src", "cli.ts")]);
  });
});
