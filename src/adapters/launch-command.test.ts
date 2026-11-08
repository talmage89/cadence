import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { temporaryDirectory } from "#testing/fakes.ts";
import { heldLaunchCommand, isLaunchOf, type LaunchCommand, launchCommand, shellCommandLine } from "./launch-command.ts";

interface RunParams {
  launch: LaunchCommand;
  input?: string;
}

function runLaunched({ launch, input = "" }: RunParams): string {
  const [executable = "", ...commandArguments] = launch.argv;
  const { stdout } = spawnSync(executable, commandArguments, { encoding: "utf8", input, env: { PATH: "/usr/bin:/bin", SHELL: "/bin/sh" } });

  return stdout;
}

const printArguments = ["/bin/sh", "-c", 'printf "[%s]" "$@"', "probe", "two words", "it's quoted"];

describe("launchCommand", () => {
  it("should hand the command its arguments intact through the login shell", () => {
    const stdout = runLaunched({ launch: launchCommand(printArguments) });

    assert.equal(stdout, "[two words][it's quoted]");
  });

  it("should give the command its launch id in its environment", () => {
    const launch = launchCommand(["/bin/sh", "-c", 'printf "%s" "$CADENCE_LAUNCH_ID"']);

    const stdout = runLaunched({ launch });

    assert.equal(stdout, launch.launchId);
  });

  it("should use a fresh launch id every time", () => {
    assert.notEqual(launchCommand(["agent"]).launchId, launchCommand(["agent"]).launchId);
  });
});

describe("heldLaunchCommand", () => {
  it("should run the command in the directory, then report how it ended and wait for Enter", () => {
    const cwd = temporaryDirectory();
    const launch = heldLaunchCommand({ command: ["/bin/sh", "-c", 'printf "[%s][%s]" "$(pwd -P)" "$1"; exit 3', "probe", "it's quoted"], cwd });

    const stdout = runLaunched({ launch, input: "\n" });

    assert.match(stdout, new RegExp(`^\\[${cwd}\\]\\[it's quoted\\]`));
    assert.match(stdout, /\[cadence: exited with status 3; press Enter to close\]\n$/);
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

describe("shellCommandLine", () => {
  it("should quote words so a shell reads back the same words", () => {
    const words = ["printf", "[%s]", "two words", "it's", "$HOME", "back\\slash", ""];

    const { stdout } = spawnSync("/bin/sh", ["-c", shellCommandLine(words)], { encoding: "utf8" });

    assert.equal(stdout, "[two words][it's][$HOME][back\\slash][]");
  });
});
