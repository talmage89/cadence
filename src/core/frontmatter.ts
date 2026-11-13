import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";
import { z } from "zod";
import { parseOrThrow } from "./validation.ts";

export interface Frontmatter {
  fields: Record<string, unknown>;
  body: string;
}

const frontmatterPattern = /^(?<opening>---\r?\n)(?<yaml>[\s\S]*?)\r?\n---(?:\r?\n|$)/;

const fieldsSchema = z
  .record(z.string(), z.unknown(), { error: "frontmatter must be a mapping of keys to values" })
  .nullish()
  .transform((fields) => fields ?? {});

export function splitFrontmatter(text: string): Frontmatter {
  const match = text.match(frontmatterPattern);
  if (!match) {
    return { fields: {}, body: text };
  }

  const [block] = match;
  return { fields: parseOrThrow(fieldsSchema, parse(match.groups?.yaml ?? "")), body: text.slice(block.length) };
}

/** Rewrites the value on a top-level `key:` line and nothing else, so comments and layout survive. */
export function setFrontmatterFlag(text: string, key: string, value: boolean): string {
  const groups = text.match(frontmatterPattern)?.groups;
  if (groups?.opening === undefined || groups.yaml === undefined) {
    throw new Error("the file has no frontmatter");
  }

  const { opening, yaml } = groups;
  const rewrittenYaml = yaml
    .split("\n")
    .map((line) => replaceFlagValue(line, key, value))
    .join("\n");
  const rewritten = `${opening}${rewrittenYaml}${text.slice(opening.length + yaml.length)}`;

  const expectedFields = { ...splitFrontmatter(text).fields, [key]: value };
  if (!isDeepStrictEqual(splitFrontmatter(rewritten).fields, expectedFields)) {
    throw new Error(`found no "${key}: …" line to rewrite`);
  }

  return rewritten;
}

const flagLinePattern = /^(?<key>[^\s:#]+)(?<separator>[ \t]*:[ \t]*)[^\s#]+(?<rest>[\s\S]*)$/;

function replaceFlagValue(line: string, key: string, value: boolean): string {
  const groups = line.match(flagLinePattern)?.groups;
  if (groups?.key !== key) {
    return line;
  }

  const { separator = "", rest = "" } = groups;
  return `${key}${separator}${value}${rest}`;
}
