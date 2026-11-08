import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appleScriptCompileError, type AppleScriptCall, fakeAppleScript, isApplicationInstalled } from "#testing/fakes.ts";
import { ghostty } from "./ghostty.ts";

const terminalId = "8EF148DD-E543-4BCB-8FFA-C7E41330A954";
const newTerminalId = "B5D6B31E-7F4A-4699-B345-F3DB6FFC8AFF";
const handle = { terminalId };
const openRequest = { title: "digest", cwd: "/work", command: ["node", "cli.ts", "run", "digest"], options: {}, replacing: null };

function replyLikeGhostty({ script }: AppleScriptCall): string {
  if (script.includes("new surface configuration")) {
    return newTerminalId;
  }

  return script.includes("return tty of") ? "/dev/ttys020" : "true";
}

describe("ghostty", () => {
  describe("isAvailable", () => {
    it("should ask whether Ghostty is running", () => {
      const appleScript = fakeAppleScript(() => "true");
      const terminal = ghostty({ execute: appleScript.execute });

      assert.equal(terminal.isAvailable(), true);
      assert.deepEqual(appleScript.calls[0]?.scriptArguments, ["com.mitchellh.ghostty"]);
    });
  });

  describe("open", () => {
    it("should open a terminal titled after the agent, running the launch command in its directory", () => {
      const appleScript = fakeAppleScript(replyLikeGhostty);
      const terminal = ghostty({ execute: appleScript.execute });

      const openedHandle = terminal.open(openRequest);
      const [commandLine = "", cwd, title, ...placement] = appleScript.calls[0]?.scriptArguments ?? [];

      assert.deepEqual(openedHandle, { terminalId: newTerminalId });
      assert.match(commandLine, /^'\/usr\/bin\/env' 'CADENCE_LAUNCH_ID=[0-9a-f-]{36}' '\/bin\/sh' '-c' '.*' 'cadence' 'node' 'cli\.ts' 'run' 'digest'$/s);
      assert.deepEqual([cwd, title, placement], ["/work", "digest", []]);
    });

    it("should ask to split the previous terminal, so the new one takes its place", () => {
      const appleScript = fakeAppleScript(replyLikeGhostty);

      ghostty({ execute: appleScript.execute }).open({ ...openRequest, replacing: handle });

      assert.equal(appleScript.calls[0]?.scriptArguments[3], terminalId);
    });

    it("should report an unexpected terminal id", () => {
      const terminal = ghostty({ execute: fakeAppleScript(() => "").execute });

      assert.throws(() => terminal.open(openRequest), /Ghostty returned an unexpected terminal id/);
    });
  });

  describe("isLive", () => {
    it("should be true while Ghostty still has the terminal", () => {
      assert.equal(ghostty({ execute: fakeAppleScript(() => "true").execute }).isLive(handle), true);
      assert.equal(ghostty({ execute: fakeAppleScript(() => "false").execute }).isLive(handle), false);
    });
  });

  describe("deliver", () => {
    it("should paste the text into the terminal", () => {
      const appleScript = fakeAppleScript();

      ghostty({ execute: appleScript.execute }).deliver(handle, "Your instructions are in /agents/digest.md.");

      assert.deepEqual(appleScript.calls[0]?.scriptArguments, [terminalId, "Your instructions are in /agents/digest.md."]);
    });
  });

  describe("close", () => {
    it("should hang up the terminal's tty before closing it, since Ghostty keeps a closed terminal's processes", () => {
      const appleScript = fakeAppleScript(replyLikeGhostty);
      const hungUp: string[] = [];

      ghostty({ execute: appleScript.execute, hangUp: (tty) => hungUp.push(tty) }).close(handle);

      assert.deepEqual(hungUp, ["/dev/ttys020"]);
      assert.deepEqual(
        appleScript.calls.map((call) => call.scriptArguments),
        [[terminalId], [terminalId]],
      );
    });

    it("should do nothing when the terminal is gone", () => {
      const appleScript = fakeAppleScript(() => "");
      const hungUp: string[] = [];

      ghostty({ execute: appleScript.execute, hangUp: (tty) => hungUp.push(tty) }).close(handle);

      assert.deepEqual(hungUp, []);
      assert.equal(appleScript.calls.length, 1);
    });
  });

  describe("scripts", { skip: !isApplicationInstalled("/Applications/Ghostty.app") && "Ghostty is not installed" }, () => {
    it("should compile against Ghostty's dictionary", () => {
      const appleScript = fakeAppleScript(replyLikeGhostty);
      const terminal = ghostty({ execute: appleScript.execute, hangUp: () => {} });

      terminal.isAvailable();
      terminal.open({ ...openRequest, replacing: handle });
      terminal.isLive(handle);
      terminal.deliver(handle, "text");
      terminal.close(handle);

      assert.deepEqual(
        appleScript.calls.map(({ script }) => appleScriptCompileError(script)),
        appleScript.calls.map(() => null),
      );
    });
  });
});
