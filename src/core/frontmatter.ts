import { parse } from "yaml";
import { z } from "zod";
import { parseOrThrow } from "./validation.ts";

export interface Frontmatter {
  fields: Record<string, unknown>;
  body: string;
}

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const fieldsSchema = z
  .record(z.string(), z.unknown(), { error: "frontmatter must be a mapping of keys to values" })
  .nullish()
  .transform((fields) => fields ?? {});

export function splitFrontmatter(text: string): Frontmatter {
  const match = text.match(frontmatterPattern);
  if (!match) {
    return { fields: {}, body: text };
  }

  const [block, yaml = ""] = match;
  return { fields: parseOrThrow(fieldsSchema, parse(yaml)), body: text.slice(block.length) };
}
