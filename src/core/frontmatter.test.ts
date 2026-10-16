import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitFrontmatter } from "./frontmatter.ts";

describe("splitFrontmatter", () => {
  it("parses YAML fields and returns the body", () => {
    const { fields, body } = splitFrontmatter('---\nschedule: "0 9 * * 1-5"\nenabled: false\ntools:\n  - Read\n  - Bash\n---\n\n# Agent\n');
    assert.deepEqual(fields, { schedule: "0 9 * * 1-5", enabled: false, tools: ["Read", "Bash"] });
    assert.equal(body, "\n# Agent\n");
  });

  it("returns no fields when there is no frontmatter", () => {
    assert.deepEqual(splitFrontmatter("# Agent\n"), { fields: {}, body: "# Agent\n" });
  });

  it("returns no fields for empty frontmatter", () => {
    assert.deepEqual(splitFrontmatter("---\n\n---\nbody").fields, {});
  });

  it("accepts CRLF line endings", () => {
    assert.deepEqual(splitFrontmatter("---\r\nreuse: true\r\n---\r\nbody").fields, { reuse: true });
  });

  it("rejects frontmatter that is not a mapping", () => {
    assert.throws(() => splitFrontmatter("---\n- one\n- two\n---\n"), /mapping/);
  });

  it("rejects invalid YAML", () => {
    assert.throws(() => splitFrontmatter("---\nkey: [unclosed\n---\n"));
  });
});
