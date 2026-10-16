import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { OpenRequest, Runner, Terminal } from "../core/ports.ts";
import type { Runtime } from "../core/runtime.ts";

const terminalOptions = z.object({ session: z.string().default("main") });
const terminalHandle = z.object({ pane: z.string() });

export interface FakeTerminal extends Terminal<typeof terminalOptions, typeof terminalHandle> {
  available: boolean;
  livePanes: Set<string>;
  environmentHandle: { pane: string } | null;
  failOpenWith: Error | null;
  opened: OpenRequest<z.output<typeof terminalOptions>>[];
  delivered: { pane: string; text: string }[];
}

export function fakeTerminal(): FakeTerminal {
  const terminal: FakeTerminal = {
    options: terminalOptions,
    handle: terminalHandle,
    available: true,
    livePanes: new Set(),
    environmentHandle: null,
    failOpenWith: null,
    opened: [],
    delivered: [],

    isAvailable() {
      return terminal.available;
    },
    open(request) {
      if (terminal.failOpenWith) throw terminal.failOpenWith;
      terminal.opened.push(request);
    },
    currentHandle() {
      return terminal.environmentHandle;
    },
    isLive({ pane }) {
      return terminal.livePanes.has(pane);
    },
    deliver({ pane }, text) {
      terminal.delivered.push({ pane, text });
    },
  };
  return terminal;
}

const runnerOptions = z.object({ script: z.string().default("") });

export function nodeRunner(): Runner<typeof runnerOptions> {
  return {
    options: runnerOptions,
    command(_prompt, { script }) {
      return [process.execPath, "-e", script];
    },
  };
}

export function temporaryDirectory(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "cadence-test-")));
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

export function writeSpec(directory: string, name: string, frontmatter: string): string {
  const file = join(directory, `${name}.md`);
  writeFileSync(file, `---\n${frontmatter}\n---\n\nDo the work.\n`);
  return file;
}
