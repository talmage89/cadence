import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claude } from "./claude.ts";

describe("claude", () => {
  const runner = claude();

  it("defaults to no subagents", () => {
    const options = runner.options.parse({});
    assert.deepEqual(runner.command("go", options), ["claude", "go", "--disallowedTools", "Agent", "Workflow"]);
  });

  it("passes permission mode, model, and allowed tools", () => {
    const options = runner.options.parse({ "permission-mode": "auto", model: "sonnet", tools: ["Read", "Bash(git *)"], subagents: true });
    assert.deepEqual(runner.command("go", options), [
      "claude",
      "go",
      "--permission-mode",
      "auto",
      "--model",
      "sonnet",
      "--allowedTools",
      "Read",
      "Bash(git *)",
    ]);
  });

  it("omits an empty tool list", () => {
    const options = runner.options.parse({ tools: [], subagents: true });
    assert.deepEqual(runner.command("go", options), ["claude", "go"]);
  });

  it("uses a configured executable", () => {
    const custom = claude({ executable: "/opt/bin/claude" });
    assert.equal(custom.command("go", custom.options.parse({}))[0], "/opt/bin/claude");
  });

  it("rejects options of the wrong type", () => {
    assert.equal(runner.options.safeParse({ subagents: "yes" }).success, false);
    assert.equal(runner.options.safeParse({ tools: "Read" }).success, false);
  });
});
