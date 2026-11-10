import { z } from "zod";
import { expandHome } from "#core/paths.ts";
import type { Runner } from "#core/ports.ts";

export interface ClaudeParams {
  executable?: string;
}

const optionsSchema = z.object({
  "permission-mode": z.string().optional(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  settings: z.string().optional(),
  "add-dir": z.array(z.string()).optional(),
});

export function claude({ executable = "claude" }: ClaudeParams = {}): Runner<typeof optionsSchema> {
  return {
    options: optionsSchema,

    command(prompt, { "permission-mode": permissionMode, model, tools = [], settings, "add-dir": addedDirectories = [] }) {
      const command = [executable, prompt];
      if (permissionMode) {
        command.push("--permission-mode", permissionMode);
      }

      if (model) {
        command.push("--model", model);
      }

      if (tools.length > 0) {
        command.push("--allowedTools", ...tools);
      }

      if (settings) {
        command.push("--settings", expandHome(settings));
      }

      if (addedDirectories.length > 0) {
        command.push("--add-dir", ...addedDirectories.map(expandHome));
      }

      return command;
    },
  };
}
