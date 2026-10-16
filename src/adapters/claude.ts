import { z } from "zod";
import type { Runner } from "../core/ports.ts";

export interface ClaudeSettings {
  executable?: string;
}

const options = z.object({
  "permission-mode": z.string().optional(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  subagents: z.boolean().default(false),
});

export function claude({ executable = "claude" }: ClaudeSettings = {}): Runner<typeof options> {
  return {
    options,

    command(prompt, { "permission-mode": permissionMode, model, tools, subagents }) {
      const command = [executable, prompt];
      if (permissionMode) command.push("--permission-mode", permissionMode);
      if (model) command.push("--model", model);
      if (tools && tools.length > 0) command.push("--allowedTools", ...tools);
      if (!subagents) command.push("--disallowedTools", "Agent", "Workflow");
      return command;
    },
  };
}
