import { z } from "zod";
import type { Terminal } from "#core/ports.ts";
import { parseOrThrow } from "#core/validation.ts";
import { type AppleScriptExecutor, executeAppleScript, isApplicationRunning } from "./apple-script.ts";
import { heldLaunchCommand, shellCommandLine } from "./launch-command.ts";

export interface Iterm2Params {
  execute?: AppleScriptExecutor;
}

const optionsSchema = z.object({});
const handleSchema = z.object({ sessionId: z.string() });

export function iterm2({ execute = executeAppleScript }: Iterm2Params = {}): Terminal<typeof optionsSchema, typeof handleSchema> {
  return {
    options: optionsSchema,
    handle: handleSchema,

    isAvailable() {
      return isApplicationRunning(execute, bundleId);
    },

    open({ cwd, command, replacing }) {
      const commandLine = shellCommandLine(heldLaunchCommand({ command, cwd }).argv);
      const placement = replacing === null ? [] : [replacing.sessionId];

      return { sessionId: parseOrThrow(sessionIdSchema, execute(openScript, [commandLine, ...placement])) };
    },

    isLive({ sessionId }) {
      return parseOrThrow(z.stringbool(), execute(existsScript, [sessionId]));
    },

    deliver({ sessionId }, text) {
      execute(deliverScript, [sessionId, text]);
    },

    close({ sessionId }) {
      execute(closeScript, [sessionId]);
    },
  };
}

const bundleId = "com.googlecode.iterm2";

const sessionIdSchema = z.string().regex(/^[0-9A-F-]{36}$/i, { error: (issue) => `iTerm2 returned an unexpected session id: ${String(issue.input)}` });

const findSessionHandler = `on findSession(sessionId)
	tell application id "${bundleId}"
		repeat with candidateWindow in windows
			repeat with candidateTab in tabs of candidateWindow
				repeat with candidateSession in sessions of candidateTab
					if id of candidateSession is sessionId then return candidateSession
				end repeat
			end repeat
		end repeat
	end tell
	return missing value
end findSession`;

const openScript = `on run argv
	set commandLine to item 1 of argv
	tell application id "${bundleId}"
		if (count of argv) > 1 then
			set anchor to my findSession(item 2 of argv)
			if anchor is not missing value then
				tell anchor to set newSession to (split horizontally with default profile command commandLine)
				return id of newSession
			end if
		end if
		set newWindow to (create window with default profile command commandLine)
		return id of current session of newWindow
	end tell
end run

${findSessionHandler}`;

const existsScript = `on run argv
	return (my findSession(item 1 of argv) is not missing value) as text
end run

${findSessionHandler}`;

const deliverScript = `on run argv
	set target to my findSession(item 1 of argv)
	tell application id "${bundleId}"
		tell target to write text (item 2 of argv) newline no
		delay 0.2
		tell target to write text (character id 13) newline no
	end tell
end run

${findSessionHandler}`;

const closeScript = `on run argv
	set target to my findSession(item 1 of argv)
	if target is missing value then return
	tell application id "${bundleId}" to tell target to close
end run

${findSessionHandler}`;
