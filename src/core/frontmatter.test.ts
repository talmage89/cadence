import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setFrontmatterFlag, splitFrontmatter } from "./frontmatter.ts";

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

describe("setFrontmatterFlag", () => {
  it("should rewrite only the flag's value", () => {
    const text = '---\nschedule: 0 9 * * 1-5 # weekdays\nrun-now: true   # once\nadd-dir:\n  - ~/code\n---\n\nrun-now: true\n';

    const rewritten = setFrontmatterFlag(text, "run-now", false);

    assert.equal(rewritten, '---\nschedule: 0 9 * * 1-5 # weekdays\nrun-now: false   # once\nadd-dir:\n  - ~/code\n---\n\nrun-now: true\n');
  });

  it("should keep CRLF line endings", () => {
    const rewritten = setFrontmatterFlag("---\r\nreuse: true\r\nrun-now: true\r\n---\r\nbody", "run-now", false);

    assert.equal(rewritten, "---\r\nreuse: true\r\nrun-now: false\r\n---\r\nbody");
  });

  it("should leave a nested key of the same name alone", () => {
    const text = "---\nsettings:\n  run-now: true\nrun-now: true\n---\n";

    assert.equal(setFrontmatterFlag(text, "run-now", false), "---\nsettings:\n  run-now: true\nrun-now: false\n---\n");
  });

  it("should refuse a key that is not on a line of its own", () => {
    assert.throws(() => setFrontmatterFlag("---\n{ reuse: true, run-now: true }\n---\n", "run-now", false), /no "run-now: …" line/);
  });

  it("should refuse a key that is missing", () => {
    assert.throws(() => setFrontmatterFlag("---\nreuse: true\n---\n", "run-now", false), /no "run-now: …" line/);
  });

  it("should refuse a file without frontmatter", () => {
    assert.throws(() => setFrontmatterFlag("# Agent\n", "run-now", false), /no frontmatter/);
  });
});
