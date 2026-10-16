import { homedir } from "node:os";
import { join } from "node:path";
import { claude } from "./src/adapters/claude.ts";
import { macosAwake } from "./src/adapters/macos-awake.ts";
import { zellij } from "./src/adapters/zellij.ts";
import { defineConfig } from "./src/config.ts";

export default defineConfig((environment) => {
  const stateDirectory = environment.require("CADENCE_STATE_DIRECTORY");

  return {
    agentsDirectory: environment.require("CADENCE_AGENTS_DIRECTORY"),
    stateDirectory,
    logDirectory: environment.optional("CADENCE_LOG_DIRECTORY") ?? join(stateDirectory, "logs"),
    defaultCwd: environment.optional("CADENCE_DEFAULT_CWD") ?? homedir(),
    gates: [macosAwake({ settleMinutes: 5 })],
    terminal: zellij(),
    runner: claude(),
  };
});
