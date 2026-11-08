import { randomUUID } from "node:crypto";
import { z } from "zod";

export interface LaunchCommand {
  launchId: string;
  argv: string[];
}

/**
 * Wraps `command` to run through the user's login shell under a fresh launch id. The id rides in both the
 * session's environment and its start command, so a handle can prove it still names the pane it was made for.
 */
export function launchCommand(command: string[]): LaunchCommand {
  const launchId = randomUUID();

  return {
    launchId,
    argv: ["/usr/bin/env", launchAssignment(launchId), "/bin/sh", "-c", loginShellScript, "cadence", ...command],
  };
}

export function readLaunchId(environment: NodeJS.ProcessEnv): string | null {
  const result = launchEnvironmentSchema.safeParse(environment);
  return result.success ? result.data : null;
}

export function isLaunchOf(startCommand: string | null, launchId: string): boolean {
  return startCommand !== null && startCommand.includes(launchAssignment(launchId));
}

const launchIdVariable = "CADENCE_LAUNCH_ID";
const loginShellScript = `exec "\${SHELL:-/bin/sh}" -lic 'exec "$0" "$@"' "$@"`;

const launchEnvironmentSchema = z.object({ [launchIdVariable]: z.uuid() }).transform((environment) => environment[launchIdVariable]);

function launchAssignment(launchId: string): string {
  return `${launchIdVariable}=${launchId}`;
}
