import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claude } from "./claude.ts";

describe("claude", () => {
  const runner = claude();

  describe("command", () => {
    it("should start Claude on the prompt alone when no options are set", () => {
      const options = runner.options.parse({});

      assert.deepEqual(runner.command("go", options), ["claude", "go"]);
    });

    it("should pass permission mode, model, and allowed tools", () => {
      const options = runner.options.parse({ "permission-mode": "auto", model: "sonnet", tools: ["Read", "Bash(git *)"] });

      const command = runner.command("go", options);

      assert.deepEqual(command, ["claude", "go", "--permission-mode", "auto", "--model", "sonnet", "--allowedTools", "Read", "Bash(git *)"]);
    });

    it("should omit an empty tool list", () => {
      const options = runner.options.parse({ tools: [] });

      assert.deepEqual(runner.command("go", options), ["claude", "go"]);
    });

    it("should use a configured executable", () => {
      const custom = claude({ executable: "/opt/bin/claude" });

      assert.equal(custom.command("go", custom.options.parse({}))[0], "/opt/bin/claude");
    });
  });

  describe("options", () => {
    it("should reject values of the wrong type", () => {
      assert.equal(runner.options.safeParse({ model: 4 }).success, false);
      assert.equal(runner.options.safeParse({ tools: "Read" }).success, false);
    });
  });
});
