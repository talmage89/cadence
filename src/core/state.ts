import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const agentStateSchema = z.object({
  lastChecked: z.string(),
  lastStarted: z.string().optional(),
  lastError: z.string().optional(),
});

const dispatchStateSchema = z.object({
  gates: z.record(z.string(), z.unknown()),
  agents: z.record(z.string(), agentStateSchema),
});

export type AgentState = z.output<typeof agentStateSchema>;
export type DispatchState = z.output<typeof dispatchStateSchema>;

export function loadState(file: string): DispatchState {
  if (!existsSync(file)) return { gates: {}, agents: {} };

  const result = dispatchStateSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!result.success) throw new Error(`state file ${file} is malformed: ${result.error.message}`);
  return result.data;
}

export function saveState(file: string, state: DispatchState): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporaryFile, file);
}
