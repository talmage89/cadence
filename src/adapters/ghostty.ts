import { z } from "zod";
import type { Terminal } from "#core/ports.ts";
import { parseOrThrow } from "#core/validation.ts";
import { type AppleScriptExecutor, executeAppleScript, isApplicationRunning } from "./apple-script.ts";
import { launchCommand, shellCommandLine } from "./launch-command.ts";
import { hangUpTty, type TtyHangUp } from "./tty.ts";

export interface GhosttyParams {
  execute?: AppleScriptExecutor;
  hangUp?: TtyHangUp;
}

const optionsSchema = z.object({});
const handleSchema = z.object({ terminalId: z.string() });

export function ghostty({ execute = executeAppleScript, hangUp = hangUpTty }: GhosttyParams = {}): Terminal<typeof optionsSchema, typeof handleSchema> {
  return {
    options: optionsSchema,
    handle: handleSchema,

    isAvailable() {
      return isApplicationRunning(execute, bundleId);
    },

    open({ title, cwd, command, replacing }) {
      const commandLine = shellCommandLine(launchCommand(command).argv);
      const placement = replacing === null ? [] : [replacing.terminalId];

      return { terminalId: parseOrThrow(terminalIdSchema, execute(openScript, [commandLine, cwd, title, ...placement])) };
    },

    isLive({ terminalId }) {
      return parseOrThrow(z.stringbool(), execute(existsScript, [terminalId]));
    },

    deliver({ terminalId }, text) {
      execute(deliverScript, [terminalId, text]);
    },

    close({ terminalId }) {
      const tty = parseOrThrow(ttySchema, execute(ttyScript, [terminalId]));
      if (tty === null) {
        return;
      }

      hangUp(tty);
      execute(closeScript, [terminalId]);
    },
  };
}

const bundleId = "com.mitchellh.ghostty";

const terminalIdSchema = z.string().regex(/^[0-9A-F-]{36}$/i, { error: (issue) => `Ghostty returned an unexpected terminal id: ${String(issue.input)}` });

const openScript = `on run argv
	tell application id "${bundleId}"
		set configuration to new surface configuration
		set command of configuration to item 1 of argv
		set initial working directory of configuration to item 2 of argv
		set wait after command of configuration to true
		set newTerminal to missing value
		if (count of argv) > 3 then
			set anchors to (every terminal whose id is (item 4 of argv))
			if (count of anchors) > 0 then set newTerminal to (split (item 1 of anchors) direction down with configuration configuration)
		end if
		if newTerminal is missing value then set newTerminal to focused terminal of selected tab of (new window with configuration configuration)
		set name override of newTerminal to item 3 of argv
		return id of newTerminal
	end tell
end run`;

const ttySchema = z.union([z.literal("").transform(() => null), z.string().regex(/^\/dev\/tty\w+$/)]);

const ttyScript = `on run argv
	tell application id "${bundleId}"
		set matches to every terminal whose id is (item 1 of argv)
		if (count of matches) is 0 then return ""
		return tty of (item 1 of matches)
	end tell
end run`;

const existsScript = `on run argv
	tell application id "${bundleId}" to return ((count of (every terminal whose id is (item 1 of argv))) > 0) as text
end run`;

const deliverScript = `on run argv
	tell application id "${bundleId}"
		set target to first terminal whose id is (item 1 of argv)
		input text (item 2 of argv) to target
		send key "enter" to target
	end tell
end run`;

const closeScript = `on run argv
	tell application id "${bundleId}"
		repeat with target in (every terminal whose id is (item 1 of argv))
			close target
		end repeat
	end tell
end run`;
