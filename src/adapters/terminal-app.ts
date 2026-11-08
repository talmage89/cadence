import { z } from "zod";
import type { Terminal } from "#core/ports.ts";
import { parseOrThrow } from "#core/validation.ts";
import { type AppleScriptExecutor, executeAppleScript, isApplicationRunning } from "./apple-script.ts";
import { heldLaunchCommand, shellCommandLine } from "./launch-command.ts";
import { hangUpTty, type TtyHangUp } from "./tty.ts";

export interface TerminalAppParams {
  execute?: AppleScriptExecutor;
  hangUp?: TtyHangUp;
}

const optionsSchema = z.object({});
const handleSchema = z.object({ windowId: z.number().int(), tty: z.string(), title: z.string() });

type TerminalAppHandle = z.output<typeof handleSchema>;

export function terminalApp({ execute = executeAppleScript, hangUp = hangUpTty }: TerminalAppParams = {}): Terminal<
  typeof optionsSchema,
  typeof handleSchema
> {
  return {
    options: optionsSchema,
    handle: handleSchema,

    isAvailable() {
      return isApplicationRunning(execute, bundleId);
    },

    open({ title, cwd, command, replacing }) {
      const typedCommand = ` exec ${shellCommandLine(heldLaunchCommand({ command, cwd }).argv)}`;
      const placement = replacing === null ? [] : handleArguments(replacing);
      const { windowId, tty } = parseOrThrow(openedTabSchema, execute(openScript, [typedCommand, title, ...placement]));

      return { windowId, tty, title };
    },

    isLive(handle: TerminalAppHandle) {
      return isAgentTabOpen(execute, handle);
    },

    deliver(handle: TerminalAppHandle, text) {
      execute(deliverScript, [...handleArguments(handle), text]);
    },

    close(handle: TerminalAppHandle) {
      if (!isAgentTabOpen(execute, handle)) {
        return;
      }

      hangUp(handle.tty);
      execute(closeScript, handleArguments(handle));
    },
  };
}

const bundleId = "com.apple.Terminal";

const openedTabSchema = z
  .string()
  .transform((output) => output.split("\n"))
  .pipe(
    z.tuple([z.string().regex(/^\d+$/).transform(Number), z.string().regex(/^\/dev\/tty\w+$/)], {
      error: (issue) => `Terminal returned an unexpected tab: ${JSON.stringify(issue.input)}`,
    }),
  )
  .transform(([windowId, tty]) => ({ windowId, tty }));

function handleArguments({ windowId, tty, title }: TerminalAppHandle): string[] {
  return [String(windowId), tty, title];
}

function isAgentTabOpen(execute: AppleScriptExecutor, handle: TerminalAppHandle): boolean {
  return parseOrThrow(z.stringbool(), execute(existsScript, handleArguments(handle)));
}

const tabHandlers = `on tabOn(windowId, ttyName)
	tell application id "${bundleId}"
		if not (exists window id windowId) then return missing value
		repeat with candidateTab in tabs of window id windowId
			if my bareTty(tty of candidateTab) is ttyName then return candidateTab
		end repeat
	end tell
	return missing value
end tabOn

on bareTty(ttyValue)
	set ttyText to ttyValue as text
	repeat while (length of ttyText) > 1 and (id of last character of ttyText) < 32
		set ttyText to text 1 thru -2 of ttyText
	end repeat
	return ttyText
end bareTty

on agentTab(windowId, ttyName, agentName)
	set candidateTab to tabOn(windowId, ttyName)
	if candidateTab is missing value then return missing value
	tell application id "${bundleId}"
		if custom title of candidateTab is not agentName then return missing value
	end tell
	return candidateTab
end agentTab

on windowIdOf(ttyName)
	tell application id "${bundleId}"
		set windowIds to id of every window
		repeat with windowId in windowIds
			set windowId to contents of windowId
			if windowId is not missing value then
				if my tabOn(windowId, ttyName) is not missing value then return windowId
			end if
		end repeat
	end tell
	error "Terminal opened no window for " & ttyName
end windowIdOf`;

const openScript = `on run argv
	tell application id "${bundleId}"
		set newTty to tty of (do script (item 1 of argv))
	end tell
	set newWindowId to windowIdOf(newTty)
	tell application id "${bundleId}"
		set custom title of (my tabOn(newWindowId, newTty)) to item 2 of argv
		if (count of argv) > 2 then
			set anchorWindowId to (item 3 of argv) as integer
			if my agentTab(anchorWindowId, item 4 of argv, item 5 of argv) is not missing value then
				set bounds of window id newWindowId to bounds of window id anchorWindowId
			end if
		end if
	end tell
	return (newWindowId as text) & linefeed & newTty
end run

${tabHandlers}`;

const existsScript = `on run argv
	return (agentTab((item 1 of argv) as integer, item 2 of argv, item 3 of argv) is not missing value) as text
end run

${tabHandlers}`;

const deliverScript = `on run argv
	set target to agentTab((item 1 of argv) as integer, item 2 of argv, item 3 of argv)
	if target is missing value then error "the agent's Terminal tab is gone"
	tell application id "${bundleId}" to do script (item 4 of argv) in target
end run

${tabHandlers}`;

const closeScript = `on run argv
	set windowId to (item 1 of argv) as integer
	set target to agentTab(windowId, item 2 of argv, item 3 of argv)
	if target is missing value then return
	tell application id "${bundleId}"
		repeat 50 times
			try
				if (count of (processes of target)) is 0 then exit repeat
			on error
				return
			end try
			delay 0.2
		end repeat
		if (count of (processes of target)) > 0 then return
		if (count of tabs of window id windowId) is 1 then close window id windowId
	end tell
end run

${tabHandlers}`;
