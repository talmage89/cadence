import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitFrontmatter } from "./frontmatter.ts";

describe("splitFrontmatter", () => {
  it("should parse YAML fields and return the body", () => {
    const text = '---\nschedule: "0 9 * * 1-5"\nenabled: false\ntools:\n  - Read\n  - Bash\n---\n\n# Agent\n';

    const { fields, body } = splitFrontmatter(text);

    assert.deepEqual(fields, { schedule: "0 9 * * 1-5", enabled: false, tools: ["Read", "Bash"] });
    assert.equal(body, "\n# Agent\n");
  });

  it("should return no fields when there is no frontmatter", () => {
    assert.deepEqual(splitFrontmatter("# Agent\n"), { fields: {}, body: "# Agent\n" });
  });

  it("should return no fields for empty frontmatter", () => {
    assert.deepEqual(splitFrontmatter("---\n\n---\nbody").fields, {});
  });

  it("should accept CRLF line endings", () => {
    assert.deepEqual(splitFrontmatter("---\r\nreuse: true\r\n---\r\nbody").fields, { reuse: true });
  });

  it("should reject frontmatter that is not a mapping", () => {
    assert.throws(() => splitFrontmatter("---\n- one\n- two\n---\n"), /mapping/);
  });

  it("should reject invalid YAML", () => {
    assert.throws(() => splitFrontmatter("---\nkey: [unclosed\n---\n"));
  });
});
