import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expandHome } from "./core/paths.ts";
import type { Runtime } from "./core/runtime.ts";

export type Config = Omit<Runtime, "supervisorCommand">;

export interface Environment {
  require(key: string): string;
  optional(key: string): string | undefined;
}

export type ConfigFactory = (environment: Environment) => Config;

export const repositoryRoot = resolve(import.meta.dirname, "..");

const cliFile = join(repositoryRoot, "src", "cli.ts");

export function defineConfig(factory: ConfigFactory): ConfigFactory {
  return factory;
}

export function createEnvironment(variables: NodeJS.ProcessEnv): Environment {
  return {
    require(key) {
      const value = variables[key];
      if (!value) throw new Error(`${key} is not set; copy .env.example to .env and fill it in`);
      return value;
    },
    optional(key) {
      return variables[key] || undefined;
    },
  };
}

export function resolveRuntime(factory: ConfigFactory, environment: Environment): Runtime {
  const config = factory(environment);
  return {
    ...config,
    agentsDirectory: resolve(expandHome(config.agentsDirectory)),
    stateDirectory: resolve(expandHome(config.stateDirectory)),
    logDirectory: resolve(expandHome(config.logDirectory)),
    defaultCwd: resolve(expandHome(config.defaultCwd)),
    supervisorCommand: [process.execPath, cliFile],
  };
}

export async function loadRuntime(): Promise<Runtime> {
  const envFile = join(repositoryRoot, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const configUrl = pathToFileURL(join(repositoryRoot, "cadence.config.ts")).href;
  const { default: factory } = (await import(configUrl)) as { default: ConfigFactory };
  return resolveRuntime(factory, createEnvironment(process.env));
}
