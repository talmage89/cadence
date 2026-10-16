import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { parseSchedule, type Schedule } from "./cron.ts";
import { parseDuration } from "./duration.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { expandHome } from "./paths.ts";
import type { Runner, Terminal } from "./ports.ts";

export type Lifetime = { kind: "resident" } | { kind: "bounded"; timeoutMilliseconds: number };

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

export type SpecLoad = { kind: "loaded"; spec: AgentSpec } | { kind: "invalid"; name: string; error: string };

export interface SpecContext {
  runner: Runner;
  terminal: Terminal;
  defaultCwd: string;
}

const defaultTimeout = "30m";

const coreFields = z.object({
  schedule: z.string(),
  enabled: z.boolean().default(true),
  cwd: z.string().optional(),
  timeout: z.string().optional(),
  reuse: z.boolean().default(false),
});

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}

function parseFields<Schema extends z.ZodObject>(schema: Schema, fields: Record<string, unknown>): z.output<Schema> {
  const result = schema.safeParse(fields);
  if (!result.success) throw new Error(describeIssues(result.error));
  return result.data;
}

function findUnknownKeys(fields: Record<string, unknown>, schemas: z.ZodObject[]): string[] {
  const knownKeys = new Set(schemas.flatMap((schema) => Object.keys(schema.shape)));
  return Object.keys(fields).filter((key) => !knownKeys.has(key));
}

function resolveLifetime(reuse: boolean, timeout: string | undefined): Lifetime {
  if (reuse && timeout !== undefined) throw new Error("timeout does not apply to an agent with reuse: true");
  if (reuse) return { kind: "resident" };
  return { kind: "bounded", timeoutMilliseconds: parseDuration(timeout ?? defaultTimeout) };
}

export function instructionsPrompt(spec: AgentSpec): string {
  return `Your instructions are in ${spec.file}. Its frontmatter only configures your schedule; carry out the instructions in the body.`;
}

export function parseSpec(name: string, file: string, text: string, context: SpecContext): AgentSpec {
  const { fields } = splitFrontmatter(text);

  const unknownKeys = findUnknownKeys(fields, [coreFields, context.runner.options, context.terminal.options]);
  if (unknownKeys.length > 0) throw new Error(`unknown frontmatter keys: ${unknownKeys.join(", ")}`);

  const core = parseFields(coreFields, fields);
  const runnerOptions = parseFields(context.runner.options, fields);
  const terminalOptions = parseFields(context.terminal.options, fields);

  return {
    name,
    file,
    schedule: parseSchedule(core.schedule),
    enabled: core.enabled,
    cwd: resolve(dirname(file), expandHome(core.cwd ?? context.defaultCwd)),
    lifetime: resolveLifetime(core.reuse, core.timeout),
    runnerOptions,
    terminalOptions,
  };
}

export function loadSpec(directory: string, fileName: string, context: SpecContext): SpecLoad {
  const name = fileName.replace(/\.md$/, "");
  const file = join(directory, fileName);

  try {
    return { kind: "loaded", spec: parseSpec(name, file, readFileSync(file, "utf8"), context) };
  } catch (error) {
    return { kind: "invalid", name, error: error instanceof Error ? error.message : String(error) };
  }
}

export function loadSpecs(directory: string, context: SpecContext): SpecLoad[] {
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".md"))
    .sort()
    .map((fileName) => loadSpec(directory, fileName, context));
}
