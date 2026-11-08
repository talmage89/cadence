import { randomUUID } from "node:crypto";

export interface LaunchCommand {
  launchId: string;
  argv: string[];
}

export interface HeldLaunchParams {
  command: string[];
  cwd: string;
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

/** For terminals that neither set a session's directory nor keep it open once its command exits. */
export function heldLaunchCommand({ command, cwd }: HeldLaunchParams): LaunchCommand {
  const launchId = randomUUID();

  return {
    launchId,
    argv: ["/usr/bin/env", launchAssignment(launchId), "/bin/sh", "-c", heldLoginShellScript, "cadence", cwd, ...command],
  };
}

export function isLaunchOf(startCommand: string | null, launchId: string): boolean {
  return startCommand !== null && startCommand.includes(launchAssignment(launchId));
}

/** Quotes `argv` into one line that a POSIX shell reads back as the same words. */
export function shellCommandLine(argv: string[]): string {
  return argv.map((word) => `'${word.replaceAll("'", `'\\''`)}'`).join(" ");
}

const launchIdVariable = "CADENCE_LAUNCH_ID";
const loginShellScript = `exec "\${SHELL:-/bin/sh}" -lic 'exec "$0" "$@"' "$@"`;

const heldLoginShellScript = [
  `cd "$1" || exit`,
  `shift`,
  `"\${SHELL:-/bin/sh}" -lic 'exec "$0" "$@"' "$@"`,
  `printf '\\n[cadence: exited with status %s; press Enter to close]\\n' "$?"`,
  `read -r reply`,
].join("\n");

function launchAssignment(launchId: string): string {
  return `${launchIdVariable}=${launchId}`;
}
