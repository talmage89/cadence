import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import { fakeTerminal, nodeRunner } from "#testing/fakes.ts";
import { defineConfig, optionalSettingSchema, repositoryRoot, resolveRuntime, settingSchema } from "./config.ts";

const definition = defineConfig({
  environment: z.object({ AGENTS: settingSchema, LOGS: optionalSettingSchema }),
  create(environment) {
    return {
      agentsDirectory: environment.AGENTS,
      stateDirectory: "~/state",
      logDirectory: environment.LOGS ?? "/tmp/logs/../logs",
      defaultCwd: "~",
      gates: [],
      terminal: fakeTerminal(),
      runner: nodeRunner(),
    };
  },
});

describe("resolveRuntime", () => {
  it("should expand and normalize every directory", () => {
    const runtime = resolveRuntime(definition, { AGENTS: "~/agents" });

    assert.equal(runtime.agentsDirectory, join(homedir(), "agents"));
    assert.equal(runtime.stateDirectory, join(homedir(), "state"));
    assert.equal(runtime.logDirectory, "/tmp/logs");
    assert.equal(runtime.defaultCwd, homedir());
  });

  it("should treat an empty optional setting as unset", () => {
    const runtime = resolveRuntime(definition, { AGENTS: "/agents", LOGS: "" });

    assert.equal(runtime.logDirectory, "/tmp/logs");
  });

  it("should point terminals at this checkout's CLI", () => {
    const runtime = resolveRuntime(definition, { AGENTS: "/agents" });

    assert.deepEqual(runtime.supervisorCommand, [process.execPath, join(repositoryRoot, "src", "cli.ts")]);
  });

  it("should name the missing settings when the environment is incomplete", () => {
    assert.throws(() => resolveRuntime(definition, { AGENTS: "" }), /environment is incomplete \(copy \.env\.example to \.env and fill it in\): AGENTS:/);
  });
});
