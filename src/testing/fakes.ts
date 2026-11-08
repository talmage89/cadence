import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { AppleScriptExecutor } from "#adapters/apple-script.ts";
import type { OpenRequest, Runner, Terminal } from "#core/ports.ts";
import type { Runtime } from "#core/runtime.ts";

const terminalOptionsSchema = z.object({ session: z.string().default("main") });
const terminalHandleSchema = z.object({ pane: z.string() });

type FakeHandle = z.output<typeof terminalHandleSchema>;

export interface FakeTerminal extends Terminal<typeof terminalOptionsSchema, typeof terminalHandleSchema> {
  isReachable: boolean;
  livePanes: Set<string>;
  openError: Error | null;
  opened: OpenRequest<z.output<typeof terminalOptionsSchema>, FakeHandle>[];
  delivered: { pane: string; text: string }[];
  closed: string[];
}

export function fakeTerminal(): FakeTerminal {
  const terminal: FakeTerminal = {
    options: terminalOptionsSchema,
    handle: terminalHandleSchema,
    isReachable: true,
    livePanes: new Set(),
    openError: null,
    opened: [],
    delivered: [],
    closed: [],

    isAvailable() {
      return terminal.isReachable;
    },
    open(request) {
      if (terminal.openError) {
        throw terminal.openError;
      }
      terminal.opened.push(request);
      return { pane: `opened-${terminal.opened.length}` };
    },
    isLive({ pane }) {
      return terminal.livePanes.has(pane);
    },
    deliver({ pane }, text) {
      terminal.delivered.push({ pane, text });
    },
    close({ pane }) {
      terminal.closed.push(pane);
    },
  };
  return terminal;
}

const runnerOptionsSchema = z.object({ script: z.string().default("") });

export function nodeRunner(): Runner<typeof runnerOptionsSchema> {
  return {
    options: runnerOptionsSchema,
    command(_prompt, { script }) {
      return [process.execPath, "-e", script];
    },
  };
}

export function fakeRuntime(overrides: Partial<Runtime> = {}): Runtime {
  const root = temporaryDirectory();
  return {
    agentsDirectory: join(root, "agents"),
    stateDirectory: join(root, "state"),
    logDirectory: join(root, "logs"),
    defaultCwd: root,
    gates: [],
    terminal: fakeTerminal(),
    runner: nodeRunner(),
    supervisorCommand: ["cadence"],
    ...overrides,
  };
}

export function temporaryDirectory(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "cadence-test-")));
}

export function writeSpec(directory: string, name: string, frontmatter: string): string {
  const file = join(directory, `${name}.md`);
  writeFileSync(file, `---\n${frontmatter}\n---\n\nDo the work.\n`);
  return file;
}

export function readLogMessages(file: string): string[] {
  if (!existsSync(file)) {
    return [];
  }

  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => line.replace(/^\S+ /, ""));
}

export interface AppleScriptCall {
  script: string;
  scriptArguments: string[];
}

export interface FakeAppleScript {
  calls: AppleScriptCall[];
  execute: AppleScriptExecutor;
}

/** Records each script an adapter runs and answers it with `reply`. */
export function fakeAppleScript(reply: (call: AppleScriptCall) => string = () => ""): FakeAppleScript {
  const calls: AppleScriptCall[] = [];
  return {
    calls,
    execute(script, scriptArguments) {
      const call = { script, scriptArguments };
      calls.push(call);
      return reply(call);
    },
  };
}

/** Compiles `script` against the dictionaries of the apps it names, returning the compiler's complaint or null. */
export function appleScriptCompileError(script: string): string | null {
  const directory = temporaryDirectory();
  const { status, stderr } = spawnSync("/usr/bin/osacompile", ["-o", join(directory, "compiled.scpt")], { input: script, encoding: "utf8" });
  rmSync(directory, { recursive: true, force: true });

  return status === 0 ? null : stderr.trim();
}

export function isApplicationInstalled(applicationPath: string): boolean {
  return process.platform === "darwin" && existsSync(applicationPath);
}
