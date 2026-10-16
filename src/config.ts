import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { expandHome } from "#core/paths.ts";
import type { Runtime } from "#core/runtime.ts";
import { describeError, parseOrThrow } from "#core/validation.ts";

export type Config = Omit<Runtime, "supervisorCommand">;

export interface ConfigDefinition<EnvironmentSchema extends z.ZodObject = z.ZodObject> {
  environment: EnvironmentSchema;
  create(environment: z.output<EnvironmentSchema>): Config;
}

export const repositoryRoot = resolve(import.meta.dirname, "..");

export const settingSchema = z.string().min(1);
export const optionalSettingSchema = z
  .string()
  .optional()
  .transform((value) => value || undefined);

export function defineConfig<EnvironmentSchema extends z.ZodObject>(
  definition: ConfigDefinition<EnvironmentSchema>,
): ConfigDefinition<EnvironmentSchema> {
  return definition;
}

export async function loadRuntime(): Promise<Runtime> {
  const envFile = join(repositoryRoot, ".env");
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  const configModule = await import(pathToFileURL(join(repositoryRoot, configFileName)).href);
  const { default: definition } = parseOrThrow(configModuleSchema, configModule);
  return resolveRuntime(definition, process.env);
}

export function resolveRuntime(definition: ConfigDefinition, variables: NodeJS.ProcessEnv): Runtime {
  const environment = parseEnvironment(definition, variables);
  const config = definition.create(environment);

  return {
    ...config,
    agentsDirectory: resolvePath(config.agentsDirectory),
    stateDirectory: resolvePath(config.stateDirectory),
    logDirectory: resolvePath(config.logDirectory),
    defaultCwd: resolvePath(config.defaultCwd),
    supervisorCommand: [process.execPath, join(repositoryRoot, "src", "cli.ts")],
  };
}

const configFileName = "cadence.config.ts";

const configModuleSchema = z.object({
  default: z.object({
    environment: z.instanceof(z.ZodObject),
    create: z.custom<ConfigDefinition["create"]>((value) => typeof value === "function"),
  }),
});

function parseEnvironment(definition: ConfigDefinition, variables: NodeJS.ProcessEnv): Record<string, unknown> {
  try {
    return parseOrThrow(definition.environment, variables);
  } catch (error) {
    throw new Error(`environment is incomplete (copy .env.example to .env and fill it in): ${describeError(error)}`);
  }
}

function resolvePath(path: string): string {
  return resolve(expandHome(path));
}
