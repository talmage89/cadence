import type { z } from "zod";

export interface OpenRequest<Options> {
  title: string;
  cwd: string;
  command: string[];
  options: Options;
}

/** Where agent sessions live. Owns the frontmatter keys in `options`. */
export interface Terminal<OptionsSchema extends z.ZodObject = z.ZodObject, HandleSchema extends z.ZodType = z.ZodType> {
  readonly options: OptionsSchema;
  readonly handle: HandleSchema;
  /** Whether sessions can be opened right now; when false, due agents wait instead of failing. */
  isAvailable(): boolean;
  /** Opens a new session running `command`. Returns once it is started, not finished. */
  open(request: OpenRequest<z.output<OptionsSchema>>): void;
  /** Called from inside a session this terminal opened: how to reach that session later, if it can be reached. */
  currentHandle(environment: NodeJS.ProcessEnv): z.output<HandleSchema> | null;
  isLive(handle: z.output<HandleSchema>): boolean;
  /** Types `text` into the session as a submitted prompt. */
  deliver(handle: z.output<HandleSchema>, text: string): void;
}

/** The agent CLI. Owns the frontmatter keys in `options`. */
export interface Runner<OptionsSchema extends z.ZodObject = z.ZodObject> {
  readonly options: OptionsSchema;
  /** The interactive command that starts an agent on `prompt`. */
  command(prompt: string, options: z.output<OptionsSchema>): string[];
}

export interface GateResult {
  ready: boolean;
  memory: unknown;
}

/** A readiness check run before any agent launches. Its memory persists between dispatches under `key`. */
export interface Gate {
  readonly key: string;
  check(memory: unknown, now: Date): GateResult;
}
