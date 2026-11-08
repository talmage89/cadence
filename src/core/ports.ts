import type { z } from "zod";

export interface OpenRequest<Options, Handle> {
  title: string;
  cwd: string;
  command: string[];
  options: Options;
  /** The agent's previous session, which the new one replaces and may take the place of. It may since have gone. */
  replacing: Handle | null;
}

/** Where agent sessions live. Owns the frontmatter keys in `options`. */
export interface Terminal<OptionsSchema extends z.ZodObject = z.ZodObject, HandleSchema extends z.ZodType = z.ZodType> {
  readonly options: OptionsSchema;
  readonly handle: HandleSchema;
  /** Whether sessions can be opened right now; when false, due agents wait instead of failing. */
  isAvailable(): boolean;
  /** Opens a new session running `command` and returns how to reach it. Returns once it is started, not finished. */
  open(request: OpenRequest<z.output<OptionsSchema>, z.output<HandleSchema>>): z.output<HandleSchema>;
  /** False once the session's pane has gone, including when a restarted terminal has given its id to another pane. */
  isLive(handle: z.output<HandleSchema>): boolean;
  /** Types `text` into the session as a submitted prompt. Called only on a handle that `isLive` just accepted. */
  deliver(handle: z.output<HandleSchema>, text: string): void;
  /**
   * Removes what a finished session left behind, such as its pane. Called after the next session has opened.
   * Leaves alone a pane whose id has since passed to another session or to the user.
   */
  close(handle: z.output<HandleSchema>): void;
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
