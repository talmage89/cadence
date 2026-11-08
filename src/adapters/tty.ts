import { execFileSync } from "node:child_process";
import { z } from "zod";
import { parseOrThrow } from "#core/validation.ts";

/** Hangs up every process attached to `tty`, as the terminal closing it would. */
export type TtyHangUp = (tty: string) => void;

/** pgrep and pkill match nothing by tty on current macOS, so this lists the processes with ps instead. */
export function hangUpTty(tty: string): void {
  for (const processId of listTtyProcesses(tty)) {
    signalHangUp(processId);
  }
}

const processIdsSchema = z
  .string()
  .transform((output) => output.split("\n").map((line) => line.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(/^\d+$/).transform(Number)));

function listTtyProcesses(tty: string): number[] {
  let output: string;
  try {
    output = execFileSync("/bin/ps", ["-o", "pid=", "-t", tty.replace(/^\/dev\//, "")], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return [];
  }

  return parseOrThrow(processIdsSchema, output);
}

function signalHangUp(processId: number): void {
  try {
    process.kill(processId, "SIGHUP");
  } catch (error) {
    const isAlreadyGone = error instanceof Error && "code" in error && error.code === "ESRCH";
    if (!isAlreadyGone) {
      throw error;
    }
  }
}
