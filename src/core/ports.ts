import type { z } from "zod";

export interface OpenRequest<Options> {
  title: string;
  cwd: string;
  command: string[];
  options: Options;
}

export interface Terminal<OptionsSchema extends z.ZodObject = z.ZodObject, HandleSchema extends z.ZodType = z.ZodType> {
  readonly options: OptionsSchema;
  readonly handle: HandleSchema;
  isAvailable(): boolean;
  open(request: OpenRequest<z.output<OptionsSchema>>): void;
  currentHandle(environment: NodeJS.ProcessEnv): z.output<HandleSchema> | null;
  isLive(handle: z.output<HandleSchema>): boolean;
  deliver(handle: z.output<HandleSchema>, text: string): void;
}

export interface Runner<OptionsSchema extends z.ZodObject = z.ZodObject> {
  readonly options: OptionsSchema;
  command(prompt: string, options: z.output<OptionsSchema>): string[];
}

export interface GateResult {
  ready: boolean;
  memory: unknown;
}

export interface Gate {
  readonly key: string;
  check(memory: unknown, now: Date): GateResult;
}
