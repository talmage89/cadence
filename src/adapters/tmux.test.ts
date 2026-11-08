import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { jsonSchema } from "#core/validation.ts";
import { temporaryDirectory } from "#testing/fakes.ts";
import { tmux } from "./tmux.ts";

interface FakeTmuxParams {
  sessions?: string[];
  windows?: string[];
  panes?: string[];
  createdPane?: string;
  isServerDown?: boolean;
}

function fakeTmux({ sessions = [], windows = [], panes = [], createdPane = "%7\t/private/tmp/tmux-501/default", isServerDown = false }: FakeTmuxParams = {}) {
  const calls: string[][] = [];
  const terminal = tmux({
    execute(tmuxArguments) {
      calls.push(tmuxArguments);
      const command = subcommandOf(tmuxArguments);

      if (isServerDown && (command === "list-sessions" || command === "list-panes")) {
        throw new Error("no server running on /tmp/tmux-501/default");
      }

      if (command === "list-sessions") {
        return sessions.join("\n");
      }

      if (command === "list-windows") {
        return windows.join("\n");
      }

      if (command === "list-panes") {
        return panes.join("\n");
      }

      if (paneCreatingCommands.has(command)) {
        return createdPane;
      }

      return "";
    },
  });
  return { calls, terminal };
}

const paneCreatingCommands = new Set(["new-session", "new-window", "split-window"]);

function subcommandOf(tmuxArguments: string[]): string {
  const hasServerFlag = tmuxArguments[0] === "-S" || tmuxArguments[0] === "-L";
  return (hasServerFlag ? tmuxArguments[2] : tmuxArguments[0]) ?? "";
}

function findCall(calls: string[][], command: string): string[] {
  return calls.find((call) => subcommandOf(call) === command) ?? [];
}

function launchedArguments(call: string[]): string[] {
  return call.slice(call.indexOf("--") + 1);
}

function sessionRow(id: string, name: string, agentName = ""): string {
  return [id, name, agentName].join("\t");
}

function windowRow(id: string, agentName = ""): string {
  return [id, agentName].join("\t");
}

function paneRow(id: string, isDead: boolean, startCommand: string): string {
  return [id, isDead ? "1" : "0", startCommand].join("\t");
}

const openRequest = { title: "digest", cwd: "/work", command: ["node", "cli.ts", "run", "digest"], options: { tmux: "agents" }, replacing: null };
const ownSessionRequest = { ...openRequest, options: {} };
const launchId = "0b7f3c52-5d2e-4f8a-9c41-2e6a8d9b1f07";
const socket = "/private/tmp/tmux-501/default";
const handle = { socket, paneId: "%5", launchId };
const launchedCommand = `/usr/bin/env CADENCE_LAUNCH_ID=${launchId} /bin/sh -c "exec ..." cadence node cli.ts run digest`;
const otherLaunchCommand = "/usr/bin/env CADENCE_LAUNCH_ID=6d1e2f30-8a4b-4c5d-9e6f-7a8b9c0d1e2f /bin/sh -c ... cadence node cli.ts run digest";

describe("tmux", () => {
  describe("options", () => {
    it("should take an optional session name and ignore other keys", () => {
      const { terminal } = fakeTmux();

      assert.deepEqual(terminal.options.parse({ tmux: "agents", other: 1 }), { tmux: "agents" });
      assert.deepEqual(terminal.options.parse({}), {});
      assert.equal(terminal.options.safeParse({ tmux: "" }).success, false);
    });
  });

  describe("isAvailable", () => {
    it("should be true when the server has a session", () => {
      const { terminal } = fakeTmux({ sessions: [sessionRow("$0", "main")] });

      assert.equal(terminal.isAvailable(), true);
    });

    it("should be false when no server is running", () => {
      const { terminal } = fakeTmux({ isServerDown: true });

      assert.equal(terminal.isAvailable(), false);
    });

    it("should talk to the configured socket name", () => {
      const calls: string[][] = [];
      const terminal = tmux({
        socketName: "work",
        execute(tmuxArguments) {
          calls.push(tmuxArguments);
          return "";
        },
      });

      terminal.isAvailable();

      assert.deepEqual(calls[0]?.slice(0, 3), ["-L", "work", "list-sessions"]);
    });
  });

  describe("open", () => {
    describe("in a named session", () => {
      it("should open a window named after the agent, without switching anyone to it", () => {
        const { calls, terminal } = fakeTmux({ sessions: [sessionRow("$0", "main"), sessionRow("$1", "agents")], windows: [windowRow("@2")] });

        terminal.open(openRequest);
        const newWindow = findCall(calls, "new-window");

        assert.deepEqual(newWindow.slice(0, newWindow.indexOf("--")), ["new-window", "-d", "-t", "$1:", "-n", "digest", "-c", "/work", "-P", "-F", "#{pane_id}\t#{socket_path}"]);
        assert.deepEqual(findCall(calls, "set-option"), ["set-option", "-w", "-t", "%7", "@cadence-window", "digest"]);
      });

      it("should run the launched command, which carries a launch id", () => {
        const { calls, terminal } = fakeTmux({ sessions: [sessionRow("$1", "agents")] });

        terminal.open(openRequest);
        const launched = launchedArguments(findCall(calls, "new-window"));

        assert.equal(launched[0], "/usr/bin/env");
        assert.match(launched[1] ?? "", /^CADENCE_LAUNCH_ID=[0-9a-f-]{36}$/);
        assert.deepEqual(launched.slice(-4), ["node", "cli.ts", "run", "digest"]);
      });

      it("should split the agent's window when it already has one, keeping the window in place", () => {
        const windows = [windowRow("@2"), windowRow("@4", "digest"), windowRow("@6", "notes")];
        const { calls, terminal } = fakeTmux({ sessions: [sessionRow("$1", "agents")], windows });

        terminal.open(openRequest);
        const split = findCall(calls, "split-window");

        assert.deepEqual(split.slice(0, 4), ["split-window", "-d", "-t", "@4"]);
        assert.equal(calls.some((call) => subcommandOf(call) === "new-window"), false);
      });

      it("should keep the pane after its command exits", () => {
        const { calls, terminal } = fakeTmux({ sessions: [sessionRow("$1", "agents")] });

        terminal.open(openRequest);

        assert.deepEqual(calls.at(-1), ["set-option", "-p", "-t", "%7", "remain-on-exit", "on"]);
      });

      it("should refuse to open anything when no session has exactly that name", () => {
        const { calls, terminal } = fakeTmux({ sessions: [sessionRow("$0", "agents-old"), sessionRow("$1", "agent")] });

        assert.throws(() => terminal.open(openRequest), /tmux session "agents" is not running; start it from your terminal/);
        assert.equal(calls.length, 1);
      });
    });

    describe("in the agent's own session", () => {
      it("should start a session named after the agent and mark it as the agent's", () => {
        const { calls, terminal } = fakeTmux({ sessions: [sessionRow("$0", "main")] });

        terminal.open(ownSessionRequest);
        const newSession = findCall(calls, "new-session");

        assert.deepEqual(newSession.slice(0, newSession.indexOf("--")), ["new-session", "-d", "-s", "digest", "-n", "digest", "-c", "/work", "-P", "-F", "#{pane_id}\t#{socket_path}"]);
        assert.deepEqual(
          calls.filter((call) => subcommandOf(call) === "set-option").map((call) => call.slice(-2)),
          [["@cadence-session", "digest"], ["@cadence-window", "digest"], ["remain-on-exit", "on"]],
        );
      });

      it("should reuse the agent's session, found by its mark rather than its name", () => {
        const sessions = [sessionRow("$0", "main"), sessionRow("$3", "renamed", "digest")];
        const { calls, terminal } = fakeTmux({ sessions, windows: [windowRow("@8", "digest")] });

        terminal.open(ownSessionRequest);

        assert.deepEqual(findCall(calls, "list-windows").slice(0, 3), ["list-windows", "-t", "$3"]);
        assert.deepEqual(findCall(calls, "split-window").slice(0, 4), ["split-window", "-d", "-t", "@8"]);
        assert.equal(calls.some((call) => subcommandOf(call) === "new-session"), false);
      });

      it("should refuse to take over a session of the agent's name that cadence did not open", () => {
        const { calls, terminal } = fakeTmux({ sessions: [sessionRow("$0", "digest")] });

        assert.throws(() => terminal.open(ownSessionRequest), /tmux session "digest" was not opened by cadence/);
        assert.equal(calls.length, 1);
      });
    });

    it("should return the new pane's handle: its server socket, its id, and the launch id its start command holds", () => {
      const { calls, terminal } = fakeTmux({ sessions: [sessionRow("$1", "agents")] });

      const openedHandle = terminal.open(openRequest);

      assert.deepEqual(openedHandle, { socket, paneId: "%7", launchId: openedHandle.launchId });
      assert.equal(findCall(calls, "new-window").includes(`CADENCE_LAUNCH_ID=${openedHandle.launchId}`), true);
    });

    it("should not configure a pane when tmux returns an unexpected pane", () => {
      const { calls, terminal } = fakeTmux({ sessions: [sessionRow("$1", "agents")], createdPane: "oops" });

      assert.throws(() => terminal.open(openRequest), /unexpected pane: \["oops"\]/);
      assert.equal(calls.some((call) => subcommandOf(call) === "set-option"), false);
    });
  });

  describe("isLive", () => {
    it("should be true when the launch's pane is running, asking the handle's server", () => {
      const { calls, terminal } = fakeTmux({ panes: [paneRow("%1", false, "zsh"), paneRow("%5", false, launchedCommand)] });

      assert.equal(terminal.isLive(handle), true);
      assert.deepEqual(calls[0]?.slice(0, 3), ["-S", socket, "list-panes"]);
    });

    it("should be false when the pane has exited, is missing, or its server is gone", () => {
      assert.equal(fakeTmux({ panes: [paneRow("%5", true, launchedCommand)] }).terminal.isLive(handle), false);
      assert.equal(fakeTmux({ panes: [] }).terminal.isLive(handle), false);
      assert.equal(fakeTmux({ isServerDown: true }).terminal.isLive(handle), false);
    });

    it("should be false when a restarted server has given the pane's id to another pane", () => {
      assert.equal(fakeTmux({ panes: [paneRow("%5", false, "-zsh")] }).terminal.isLive(handle), false);
      assert.equal(fakeTmux({ panes: [paneRow("%5", false, otherLaunchCommand)] }).terminal.isLive(handle), false);
    });

    it("should read a start command that contains tabs", () => {
      const { terminal } = fakeTmux({ panes: [paneRow("%5", false, `${launchedCommand}\twith\ttabs`)] });

      assert.equal(terminal.isLive(handle), true);
    });
  });

  describe("deliver", () => {
    it("should leave any mode the pane is in, paste the text through a buffer it then deletes, and press Enter", () => {
      // A pane you have scrolled back in is in copy mode, which would swallow the Enter.
      const { calls, terminal } = fakeTmux();

      terminal.deliver(handle, "Your instructions are in /agents/digest.md.");

      assert.deepEqual(calls, [
        ["-S", socket, "copy-mode", "-q", "-t", "%5"],
        ["-S", socket, "set-buffer", "-b", "cadence-delivery", "--", "Your instructions are in /agents/digest.md."],
        ["-S", socket, "paste-buffer", "-p", "-d", "-b", "cadence-delivery", "-t", "%5"],
        ["-S", socket, "send-keys", "-t", "%5", "Enter"],
      ]);
    });
  });

  describe("close", () => {
    it("should kill the finished session's pane", () => {
      const { calls, terminal } = fakeTmux({ panes: [paneRow("%5", true, launchedCommand)] });

      terminal.close(handle);

      assert.deepEqual(calls.at(-1), ["-S", socket, "kill-pane", "-t", "%5"]);
    });

    it("should do nothing when the pane or its server is already gone", () => {
      const withoutPane = fakeTmux({ panes: [] });
      const withoutServer = fakeTmux({ isServerDown: true });

      withoutPane.terminal.close(handle);
      withoutServer.terminal.close(handle);

      assert.equal(withoutPane.calls.some((call) => subcommandOf(call) === "kill-pane"), false);
      assert.equal(withoutServer.calls.some((call) => subcommandOf(call) === "kill-pane"), false);
    });

    it("should leave alone a pane that a restarted server gave the same id", () => {
      // After a restart, the old id can belong to one of your panes or to the run that just opened.
      const yourPane = fakeTmux({ panes: [paneRow("%5", false, "-zsh")] });
      const newRunPane = fakeTmux({ panes: [paneRow("%5", false, otherLaunchCommand)] });

      yourPane.terminal.close(handle);
      newRunPane.terminal.close(handle);

      assert.equal(yourPane.calls.some((call) => subcommandOf(call) === "kill-pane"), false);
      assert.equal(newRunPane.calls.some((call) => subcommandOf(call) === "kill-pane"), false);
    });
  });
});

const isTmuxInstalled = spawnSync("tmux", ["-V"]).status === 0;
const environmentSchema = jsonSchema(z.object({ TMUX_PANE: z.string(), CADENCE_LAUNCH_ID: z.string() }));

describe("tmux against a real server", { skip: !isTmuxInstalled && "tmux is not installed" }, () => {
  const socketName = `cadence-test-${process.pid}`;
  const workDirectory = temporaryDirectory();
  const serverEnvironment = { PATH: process.env.PATH ?? "/usr/bin:/bin", SHELL: "/bin/sh", HOME: workDirectory };
  const terminal = tmux({ socketName });

  function runTmux(tmuxArguments: string[]): string {
    return execFileSync("tmux", ["-L", socketName, ...tmuxArguments], { encoding: "utf8", env: serverEnvironment });
  }

  function startServer(): string {
    return runTmux(["-f", "/dev/null", "new-session", "-d", "-s", "agents", "-P", "-F", "#{socket_path}"]).trim();
  }

  function listPaneIds(target: string): string[] {
    return runTmux(["list-panes", "-t", target, "-F", "#{pane_id}"]).trim().split("\n");
  }

  async function openAgent(agentName: string, run: string, options: { tmux?: string }) {
    const environmentFile = join(workDirectory, `${run}.env.json`);
    const inputFile = join(workDirectory, `${run}.input`);
    const script = [
      `const fs = require("node:fs");`,
      `fs.writeFileSync(${JSON.stringify(environmentFile)}, JSON.stringify(process.env));`,
      `process.stdin.on("data", (chunk) => fs.appendFileSync(${JSON.stringify(inputFile)}, chunk));`,
    ].join("\n");

    const agentHandle = terminal.open({ title: agentName, cwd: workDirectory, command: [process.execPath, "-e", script], options, replacing: null });
    const environment = await waitFor(() => (existsSync(environmentFile) ? environmentSchema.parse(readFileSync(environmentFile, "utf8")) : null));
    assert.equal(environment.TMUX_PANE, agentHandle.paneId);
    assert.equal(environment.CADENCE_LAUNCH_ID, agentHandle.launchId);

    return { handle: agentHandle, inputFile };
  }

  let socketPath = "";

  before(() => {
    socketPath = startServer();
  });

  after(() => {
    spawnSync("tmux", ["-L", socketName, "kill-server"]);
    rmSync(socketPath, { force: true });
    rmSync(workDirectory, { recursive: true, force: true });
  });

  it("should deliver prompts to a running agent, even one scrolled back in, and replace it in place", async () => {
    const first = await openAgent("digest", "digest-1", { tmux: "agents" });
    assert.equal(terminal.isLive(first.handle), true);

    runTmux(["copy-mode", "-t", first.handle.paneId]);
    terminal.deliver(first.handle, "hello from cadence");
    await waitFor(() => (existsSync(first.inputFile) && readFileSync(first.inputFile, "utf8") === "hello from cadence\n" ? true : null));

    const second = await openAgent("digest", "digest-2", { tmux: "agents" });
    const agentWindow = runTmux(["display-message", "-p", "-t", second.handle.paneId, "#{window_id}"]).trim();
    assert.deepEqual(listPaneIds(agentWindow).toSorted(), [first.handle.paneId, second.handle.paneId].toSorted());

    terminal.close(first.handle);

    assert.deepEqual(listPaneIds(agentWindow), [second.handle.paneId]);
    assert.equal(terminal.isLive(first.handle), false);
    assert.equal(terminal.isLive(second.handle), true);
  });

  it("should keep a finished agent's pane until it is closed", async () => {
    const finished = await openAgent("brief", "brief-1", { tmux: "agents" });
    runTmux(["send-keys", "-t", finished.handle.paneId, "C-d"]);

    await waitFor(() => (terminal.isLive(finished.handle) ? null : true));
    assert.match(runTmux(["list-panes", "-a", "-F", "#{pane_id} #{pane_dead}"]), new RegExp(`^${finished.handle.paneId} 1$`, "m"));

    terminal.close(finished.handle);

    assert.doesNotMatch(runTmux(["list-panes", "-a", "-F", "#{pane_id}"]), new RegExp(`^${finished.handle.paneId}$`, "m"));
  });

  it("should give an agent with no tmux key a session of its own, and keep using it", async () => {
    const first = await openAgent("weekly", "weekly-1", {});
    const second = await openAgent("weekly", "weekly-2", {});

    assert.equal(runTmux(["show-options", "-v", "-t", second.handle.paneId, "@cadence-session"]).trim(), "weekly");
    assert.deepEqual(listPaneIds("=weekly:").toSorted(), [first.handle.paneId, second.handle.paneId].toSorted());

    terminal.close(first.handle);
    terminal.close(second.handle);

    assert.doesNotMatch(runTmux(["list-sessions", "-F", "#{session_name}"]), /^weekly$/m);
  });

  it("should leave alone the panes that reuse a launch's pane id after the server restarts", async () => {
    const stale = await openAgent("digest", "digest-3", { tmux: "agents" });
    runTmux(["kill-server"]);
    startServer();
    while (!runTmux(["list-panes", "-a", "-F", "#{pane_id}"]).split("\n").includes(stale.handle.paneId)) {
      runTmux(["new-window", "-d", "-t", "=agents:"]);
    }

    assert.equal(terminal.isLive(stale.handle), false);
    terminal.close(stale.handle);

    assert.equal(runTmux(["list-panes", "-a", "-F", "#{pane_id}"]).split("\n").includes(stale.handle.paneId), true);
  });
});

async function waitFor<Value>(probe: () => Value | null): Promise<Value> {
  const deadline = Date.now() + waitTimeoutMilliseconds;
  while (Date.now() < deadline) {
    const value = probe();
    if (value !== null) {
      return value;
    }

    await delay(waitPollMilliseconds);
  }

  throw new Error("timed out waiting on tmux");
}

const waitTimeoutMilliseconds = 10_000;
const waitPollMilliseconds = 50;
