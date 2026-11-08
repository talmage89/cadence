import { join } from "node:path";
import { z } from "zod";
import { claude } from "./src/adapters/claude.ts";
import { macosAwake } from "./src/adapters/macos-awake.ts";
import { tmux } from "./src/adapters/tmux.ts";
import { zellij } from "./src/adapters/zellij.ts";
import { defineConfig, optionalSettingSchema, settingSchema } from "./src/config.ts";

const TerminalName = { Zellij: "zellij", Tmux: "tmux" } as const;

const terminals = { [TerminalName.Zellij]: zellij, [TerminalName.Tmux]: tmux };

export default defineConfig({
  environment: z.object({
    CADENCE_AGENTS_DIRECTORY: settingSchema,
    CADENCE_STATE_DIRECTORY: settingSchema,
    CADENCE_LOG_DIRECTORY: optionalSettingSchema,
    CADENCE_DEFAULT_CWD: optionalSettingSchema,
    CADENCE_TERMINAL: optionalSettingSchema.pipe(z.enum(TerminalName).default(TerminalName.Zellij)),
  }),

  create(environment) {
    return {
      agentsDirectory: environment.CADENCE_AGENTS_DIRECTORY,
      stateDirectory: environment.CADENCE_STATE_DIRECTORY,
      logDirectory: environment.CADENCE_LOG_DIRECTORY ?? join(environment.CADENCE_STATE_DIRECTORY, "logs"),
      defaultCwd: environment.CADENCE_DEFAULT_CWD ?? environment.CADENCE_STATE_DIRECTORY,
      gates: [macosAwake({ settleMinutes: 5 })],
      terminal: terminals[environment.CADENCE_TERMINAL](),
      runner: claude(),
    };
  },
});
