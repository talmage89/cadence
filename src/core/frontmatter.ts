import { parse } from "yaml";

export interface Frontmatter {
  fields: Record<string, unknown>;
  body: string;
}

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function splitFrontmatter(text: string): Frontmatter {
  const match = text.match(frontmatterPattern);
  if (!match) return { fields: {}, body: text };

  const parsed: unknown = parse(match[1] ?? "");
  if (parsed === null || parsed === undefined) return { fields: {}, body: text.slice(match[0].length) };
  if (!isRecord(parsed)) throw new Error("frontmatter must be a mapping of keys to values");

  return { fields: parsed, body: text.slice(match[0].length) };
}
