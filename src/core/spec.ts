import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { type Schedule, scheduleSchema } from "./cron.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { expandHome } from "./paths.ts";
import type { Runner, Terminal } from "./ports.ts";
import { describeError, parseOrThrow } from "./validation.ts";

export const Lifetime = { Resident: "resident", Replaced: "replaced" } as const;
export type Lifetime = (typeof Lifetime)[keyof typeof Lifetime];

export interface AgentSpec {
  name: string;
  file: string;
  schedule: Schedule;
  enabled: boolean;
  cwd: string;
  lifetime: Lifetime;
  runnerOptions: Record<string, unknown>;
  terminalOptions: Record<string, unknown>;
}

export const SpecLoadKind = { Loaded: "loaded", Invalid: "invalid" } as const;

export type SpecLoad =
  | { kind: typeof SpecLoadKind.Loaded; spec: AgentSpec }
  | { kind: typeof SpecLoadKind.Invalid; name: string; error: string };

export interface SpecSource {
  name: string;
  file: string;
  text: string;
}

export interface SpecContext {
  runner: Runner;
  terminal: Terminal;
  defaultCwd: string;
}

const specExtension = ".md";

export function loadSpecs(directory: string, context: SpecContext): SpecLoad[] {
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(specExtension))
    .sort()
    .map((fileName) => loadSpec(directory, fileName.slice(0, -specExtension.length), context));
}

export function loadSpec(directory: string, name: string, context: SpecContext): SpecLoad {
  const file = join(directory, `${name}${specExtension}`);

  try {
    return { kind: SpecLoadKind.Loaded, spec: parseSpec({ name, file, text: readFileSync(file, "utf8") }, context) };
  } catch (error) {
    return { kind: SpecLoadKind.Invalid, name, error: describeError(error) };
  }
}

export function parseSpec({ name, file, text }: SpecSource, context: SpecContext): AgentSpec {
  const { fields } = splitFrontmatter(text);

  const unknownKeys = findUnknownKeys(fields, [coreFieldsSchema, context.runner.options, context.terminal.options]);
  if (unknownKeys.length > 0) {
    throw new Error(`unknown frontmatter keys: ${unknownKeys.join(", ")}`);
  }

  const core = parseOrThrow(coreFieldsSchema, fields);
  return {
    name,
    file,
    schedule: core.schedule,
    enabled: core.enabled,
    cwd: resolve(dirname(file), expandHome(core.cwd ?? context.defaultCwd)),
    lifetime: core.reuse ? Lifetime.Resident : Lifetime.Replaced,
    runnerOptions: parseOrThrow(context.runner.options, fields),
    terminalOptions: parseOrThrow(context.terminal.options, fields),
  };
}

export function instructionsPrompt(spec: AgentSpec): string {
  return `Your instructions are in ${spec.file}. Its frontmatter only configures your schedule; carry out the instructions in the body.`;
}

const coreFieldsSchema = z.object({
  schedule: scheduleSchema,
  enabled: z.boolean().default(true),
  cwd: z.string().optional(),
  reuse: z.boolean().default(false),
});

function findUnknownKeys(fields: Record<string, unknown>, schemas: z.ZodObject[]): string[] {
  const knownKeys = new Set(schemas.flatMap((schema) => Object.keys(schema.shape)));
  return Object.keys(fields).filter((key) => !knownKeys.has(key));
}
