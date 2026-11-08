import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { appleScriptCompileError, type AppleScriptCall, fakeAppleScript, isApplicationInstalled, temporaryDirectory } from "#testing/fakes.ts";
import { iterm2 } from "./iterm2.ts";

const sessionId = "E1837C38-D81F-4E62-9114-0EE9ED834023";
const newSessionId = "43266BC1-8672-4676-9E4D-93A70D24219A";
const handle = { sessionId };
const openRequest = { title: "digest", cwd: "/work", command: ["node", "cli.ts", "run", "digest"], options: {}, replacing: null };

function replyLikeIterm2({ script }: AppleScriptCall): string {
  return script.includes("create window") ? newSessionId : "true";
}

describe("iterm2", () => {
  describe("isAvailable", () => {
    it("should ask whether iTerm2 is running", () => {
      const appleScript = fakeAppleScript(() => "false");
      const terminal = iterm2({ execute: appleScript.execute });

      assert.equal(terminal.isAvailable(), false);
      assert.deepEqual(appleScript.calls[0]?.scriptArguments, ["com.googlecode.iterm2"]);
    });
  });

  describe("open", () => {
    it("should open a window running the held launch command and return its session", () => {
      const appleScript = fakeAppleScript(replyLikeIterm2);
      const terminal = iterm2({ execute: appleScript.execute });

      const openedHandle = terminal.open(openRequest);
      const [commandLine = ""] = appleScript.calls[0]?.scriptArguments ?? [];

      assert.deepEqual(openedHandle, { sessionId: newSessionId });
      assert.equal(appleScript.calls[0]?.scriptArguments.length, 1);
      assert.match(commandLine, /^'\/usr\/bin\/env' 'CADENCE_LAUNCH_ID=[0-9a-f-]{36}' '\/bin\/sh' '-c' '.*' 'cadence' '\/work' 'node' 'cli\.ts' 'run' 'digest'$/s);
    });

    it("should hand a shell the command line's words intact", () => {
      const appleScript = fakeAppleScript(replyLikeIterm2);
      const cwd = temporaryDirectory();
      iterm2({ execute: appleScript.execute }).open({ ...openRequest, cwd, command: ["/bin/sh", "-c", 'printf "[%s][%s]" "$(pwd -P)" "$1"', "probe", "it's"] });
      const [commandLine = ""] = appleScript.calls[0]?.scriptArguments ?? [];

      const { stdout } = spawnSync("/bin/sh", ["-c", commandLine], { encoding: "utf8", input: "\n", env: { PATH: "/usr/bin:/bin", SHELL: "/bin/sh" } });

      assert.match(stdout, new RegExp(`^\\[${cwd}\\]\\[it's\\]`));
    });

    it("should ask to split the previous session, so the new one takes its place", () => {
      const appleScript = fakeAppleScript(replyLikeIterm2);
      const terminal = iterm2({ execute: appleScript.execute });

      terminal.open({ ...openRequest, replacing: handle });

      assert.equal(appleScript.calls[0]?.scriptArguments[1], sessionId);
    });

    it("should report an unexpected session id", () => {
      const terminal = iterm2({ execute: fakeAppleScript(() => "missing value").execute });

      assert.throws(() => terminal.open(openRequest), /iTerm2 returned an unexpected session id: missing value/);
    });
  });

  describe("isLive", () => {
    it("should be true while iTerm2 still has the session", () => {
      assert.equal(iterm2({ execute: fakeAppleScript(() => "true").execute }).isLive(handle), true);
      assert.equal(iterm2({ execute: fakeAppleScript(() => "false").execute }).isLive(handle), false);
    });
  });

  describe("deliver", () => {
    it("should type the text into the session", () => {
      const appleScript = fakeAppleScript();

      iterm2({ execute: appleScript.execute }).deliver(handle, "Your instructions are in /agents/digest.md.");

      assert.deepEqual(appleScript.calls[0]?.scriptArguments, [sessionId, "Your instructions are in /agents/digest.md."]);
    });
  });

  describe("close", () => {
    it("should close the session", () => {
      const appleScript = fakeAppleScript();

      iterm2({ execute: appleScript.execute }).close(handle);

      assert.deepEqual(appleScript.calls[0]?.scriptArguments, [sessionId]);
    });
  });

  describe("scripts", { skip: !isApplicationInstalled("/Applications/iTerm.app") && "iTerm2 is not installed" }, () => {
    it("should compile against iTerm2's dictionary", () => {
      const appleScript = fakeAppleScript(replyLikeIterm2);
      const terminal = iterm2({ execute: appleScript.execute });

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
