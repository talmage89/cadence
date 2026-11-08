import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appleScriptCompileError, type AppleScriptCall, fakeAppleScript, isApplicationInstalled } from "#testing/fakes.ts";
import { terminalApp } from "./terminal-app.ts";

const handle = { windowId: 12570, tty: "/dev/ttys015", title: "digest" };
const openRequest = { title: "digest", cwd: "/work", command: ["node", "cli.ts", "run", "digest"], options: {}, replacing: null };

function replyLikeTerminal({ script }: AppleScriptCall): string {
  return script.includes("do script (item 1 of argv)") ? "12583\n/dev/ttys019" : "true";
}

describe("terminalApp", () => {
  describe("isAvailable", () => {
    it("should ask whether Terminal is running", () => {
      const appleScript = fakeAppleScript(() => "true");
      const terminal = terminalApp({ execute: appleScript.execute });

      assert.equal(terminal.isAvailable(), true);
      assert.deepEqual(appleScript.calls[0]?.scriptArguments, ["com.apple.Terminal"]);
    });
  });

  describe("open", () => {
    it("should type the held launch command into a new window titled after the agent, and return its tab", () => {
      const appleScript = fakeAppleScript(replyLikeTerminal);
      const terminal = terminalApp({ execute: appleScript.execute });

      const openedHandle = terminal.open(openRequest);
      const [typedCommand = "", title, ...placement] = appleScript.calls[0]?.scriptArguments ?? [];

      assert.deepEqual(openedHandle, { windowId: 12583, tty: "/dev/ttys019", title: "digest" });
      assert.match(typedCommand, /^ exec '\/usr\/bin\/env' 'CADENCE_LAUNCH_ID=[0-9a-f-]{36}' '\/bin\/sh' '-c' '.*' 'cadence' '\/work' 'node' 'cli\.ts' 'run' 'digest'$/s);
      assert.deepEqual([title, placement], ["digest", []]);
    });

    it("should pass the previous tab, so the new window can take its place", () => {
      const appleScript = fakeAppleScript(replyLikeTerminal);

      terminalApp({ execute: appleScript.execute }).open({ ...openRequest, replacing: handle });

      assert.deepEqual(appleScript.calls[0]?.scriptArguments.slice(2), ["12570", "/dev/ttys015", "digest"]);
    });

    it("should report an unexpected tab", () => {
      const terminal = terminalApp({ execute: fakeAppleScript(() => "missing value").execute });

      assert.throws(() => terminal.open(openRequest), /Terminal returned an unexpected tab/);
    });
  });

  describe("isLive", () => {
    it("should be true while the agent's tab is still there", () => {
      const appleScript = fakeAppleScript(() => "true");

      assert.equal(terminalApp({ execute: appleScript.execute }).isLive(handle), true);
      assert.deepEqual(appleScript.calls[0]?.scriptArguments, ["12570", "/dev/ttys015", "digest"]);
      assert.equal(terminalApp({ execute: fakeAppleScript(() => "false").execute }).isLive(handle), false);
    });
  });

  describe("deliver", () => {
    it("should type the text into the agent's tab", () => {
      const appleScript = fakeAppleScript();

      terminalApp({ execute: appleScript.execute }).deliver(handle, "Your instructions are in /agents/digest.md.");

      assert.deepEqual(appleScript.calls[0]?.scriptArguments, ["12570", "/dev/ttys015", "digest", "Your instructions are in /agents/digest.md."]);
    });
  });

  describe("close", () => {
    it("should hang up the agent's tty before closing its window, so Terminal has no running process to ask about", () => {
      const appleScript = fakeAppleScript(() => "true");
      const hungUp: string[] = [];

      terminalApp({ execute: appleScript.execute, hangUp: (tty) => hungUp.push(tty) }).close(handle);

      assert.deepEqual(hungUp, ["/dev/ttys015"]);
      assert.deepEqual(
        appleScript.calls.map((call) => call.scriptArguments),
        [
          ["12570", "/dev/ttys015", "digest"],
          ["12570", "/dev/ttys015", "digest"],
        ],
      );
    });

    it("should leave everything alone when the agent's tab is gone, even if another tab has its tty", () => {
      const appleScript = fakeAppleScript(() => "false");
      const hungUp: string[] = [];

      terminalApp({ execute: appleScript.execute, hangUp: (tty) => hungUp.push(tty) }).close(handle);

      assert.deepEqual(hungUp, []);
      assert.equal(appleScript.calls.length, 1);
    });
  });

  describe("scripts", { skip: !isApplicationInstalled("/System/Applications/Utilities/Terminal.app") && "Terminal is not installed" }, () => {
    it("should compile against Terminal's dictionary", () => {
      const appleScript = fakeAppleScript(replyLikeTerminal);
      const terminal = terminalApp({ execute: appleScript.execute, hangUp: () => {} });

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
