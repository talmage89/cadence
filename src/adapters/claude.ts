import { z } from "zod";
import type { Runner } from "#core/ports.ts";

export interface ClaudeParams {
  executable?: string;
}

const optionsSchema = z.object({
  "permission-mode": z.string().optional(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  subagents: z.boolean().default(false),
});

export function claude({ executable = "claude" }: ClaudeParams = {}): Runner<typeof optionsSchema> {
  return {
    options: optionsSchema,

    command(prompt, { "permission-mode": permissionMode, model, tools = [], subagents }) {
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

      if (!subagents) {
        command.push("--disallowedTools", ...subagentTools);
      }

      return command;
    },
  };
}

const subagentTools = ["Agent", "Workflow"];
