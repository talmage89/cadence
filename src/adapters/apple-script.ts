import { execFileSync } from "node:child_process";
import { z } from "zod";
import { secondMilliseconds } from "#core/duration.ts";
import { describeError, parseOrThrow } from "#core/validation.ts";

/** Runs `script`, whose `on run argv` handler receives `scriptArguments`, and returns what it returns. */
export type AppleScriptExecutor = (script: string, scriptArguments: string[]) => string;

export function executeAppleScript(script: string, scriptArguments: string[]): string {
  try {
    const output = execFileSync("/usr/bin/osascript", ["-", ...scriptArguments], {
      input: script,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: appleScriptTimeoutMilliseconds,
    });
    return output.replace(/\n$/, "");
  } catch (error) {
    throw new Error(describeScriptFailure(error));
  }
}

export function isApplicationRunning(execute: AppleScriptExecutor, bundleId: string): boolean {
  return parseOrThrow(z.stringbool(), execute(runningScript, [bundleId]));
}

/** A hung app, or a permission prompt no one answers, would otherwise stall every dispatch behind it. */
const appleScriptTimeoutMilliseconds = 30 * secondMilliseconds;

const runningScript = `on run argv
	return (application id (item 1 of argv) is running) as text
end run`;

const scriptFailureSchema = z.object({ stderr: z.string().trim().min(1) });

function describeScriptFailure(error: unknown): string {
  const failure = scriptFailureSchema.safeParse(error);
  return failure.success ? `osascript: ${failure.data.stderr}` : describeError(error);
}
