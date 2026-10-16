import { z } from "zod";

export function parseOrThrow<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(describeIssues(result.error));
  }

  return result.data;
}

export function jsonSchema<Schema extends z.ZodType>(schema: Schema): z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<unknown, string>>, Schema> {
  return z.string().transform(parseJson).pipe(schema);
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}

function parseJson(text: string, context: z.RefinementCtx<string>): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    context.addIssue({ code: "custom", message: `invalid JSON: ${describeError(error)}` });
    return z.NEVER;
  }
}
