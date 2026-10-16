import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { OpenRequest, Runner, Terminal } from "#core/ports.ts";
import type { Runtime } from "#core/runtime.ts";

const terminalOptionsSchema = z.object({ session: z.string().default("main") });
const terminalHandleSchema = z.object({ pane: z.string() });

type FakeHandle = z.output<typeof terminalHandleSchema>;

export interface FakeTerminal extends Terminal<typeof terminalOptionsSchema, typeof terminalHandleSchema> {
  isReachable: boolean;
  livePanes: Set<string>;
  environmentHandle: FakeHandle | null;
  openError: Error | null;
  opened: OpenRequest<z.output<typeof terminalOptionsSchema>>[];
  delivered: { pane: string; text: string }[];
  closed: string[];
}

export function fakeTerminal(): FakeTerminal {
  const terminal: FakeTerminal = {
    options: terminalOptionsSchema,
    handle: terminalHandleSchema,
    isReachable: true,
    livePanes: new Set(),
    environmentHandle: null,
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
