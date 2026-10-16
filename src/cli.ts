import { loadRuntime } from "./config.ts";
import { dispatch } from "./core/dispatch.ts";
import { appendLog } from "./core/log.ts";
import { agentLog } from "./core/runtime.ts";
import { loadSpec } from "./core/spec.ts";
import { supervise } from "./core/supervise.ts";

const usage = `usage:
  cadence dispatch       launch every agent that is due; run this once a minute
  cadence run <agent>    supervise one agent inside the terminal session opened for it`;

async function main(cliArguments: string[]): Promise<number> {
  const [command, agentName] = cliArguments;

  if (command === "dispatch" && cliArguments.length === 1) {
    dispatch(await loadRuntime());
    return 0;
  }

  if (command === "run" && agentName && cliArguments.length === 2) {
    const runtime = await loadRuntime();
    const load = loadSpec(runtime.agentsDirectory, `${agentName}.md`, runtime);
    if (load.kind === "invalid") {
      appendLog(agentLog(runtime, agentName), `not started: ${load.error}`);
      return 1;
    }
    return supervise(load.spec, runtime);
  }

  console.error(usage);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
