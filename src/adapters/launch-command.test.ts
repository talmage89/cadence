import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { isLaunchOf, launchCommand, readLaunchId } from "./launch-command.ts";

function runLaunched(command: string[]): string {
  const [executable = "", ...commandArguments] = launchCommand(command).argv;
  const { stdout } = spawnSync(executable, commandArguments, { encoding: "utf8", env: { PATH: "/usr/bin:/bin", SHELL: "/bin/sh" } });

  return stdout;
}

describe("launchCommand", () => {
  it("should hand the command its arguments intact through the login shell", () => {
    const stdout = runLaunched(["/bin/sh", "-c", 'printf "[%s]" "$@"', "probe", "two words", "it's quoted"]);

    assert.equal(stdout, "[two words][it's quoted]");
  });

  it("should give the command a launch id it can read from its environment", () => {
    const stdout = runLaunched(["/bin/sh", "-c", 'printf "%s" "$CADENCE_LAUNCH_ID"']);

    assert.equal(readLaunchId({ CADENCE_LAUNCH_ID: stdout }), stdout);
  });

  it("should use a fresh launch id every time", () => {
    const first = launchCommand(["agent"]);
    const second = launchCommand(["agent"]);

    assert.notEqual(first.launchId, second.launchId);
  });
});

describe("readLaunchId", () => {
  it("should be null without a well-formed launch id", () => {
    assert.equal(readLaunchId({}), null);
    assert.equal(readLaunchId({ CADENCE_LAUNCH_ID: "not-a-uuid" }), null);
  });
});

describe("isLaunchOf", () => {
  it("should recognize the start command of the launch it names", () => {
    const { launchId, argv } = launchCommand(["agent"]);

    assert.equal(isLaunchOf(argv.join(" "), launchId), true);
  });

  it("should reject another launch's start command, or none", () => {
    const { launchId } = launchCommand(["agent"]);

    assert.equal(isLaunchOf(launchCommand(["agent"]).argv.join(" "), launchId), false);
    assert.equal(isLaunchOf("/bin/zsh", launchId), false);
    assert.equal(isLaunchOf(null, launchId), false);
  });
});
