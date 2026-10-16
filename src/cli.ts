import { z } from "zod";
import { dispatch } from "#core/dispatcher.ts";
import { appendLog } from "#core/log.ts";
import { agentLog } from "#core/runtime.ts";
import { loadSpec, SpecLoadKind } from "#core/spec.ts";
import { supervise } from "#core/supervisor.ts";
import { loadRuntime } from "./config.ts";

const usage = `usage:
  cadence dispatch       launch every agent that is due; run this once a minute
  cadence run <agent>    supervise one agent inside the terminal session opened for it`;

const usageExitCode = 2;

const commandSchema = z.union([z.tuple([z.literal("dispatch")]), z.tuple([z.literal("run"), z.string().min(1)])]);

async function main(cliArguments: string[]): Promise<number> {
  const command = commandSchema.safeParse(cliArguments);
  if (!command.success) {
    console.error(usage);
    return usageExitCode;
  }

  const runtime = await loadRuntime();
  const [commandName, agentName] = command.data;
  if (commandName === "dispatch") {
    dispatch(runtime);
    return 0;
  }

  const load = loadSpec(runtime.agentsDirectory, agentName, runtime);
  if (load.kind === SpecLoadKind.Invalid) {
    appendLog(agentLog(runtime, agentName), `not started: ${load.error}`);
    return 1;
  }

  return supervise(load.spec, runtime);
}

process.exitCode = await main(process.argv.slice(2));
