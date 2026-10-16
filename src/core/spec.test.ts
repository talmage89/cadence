import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fakeTerminal, nodeRunner, temporaryDirectory, writeSpec } from "../testing/fakes.ts";
import { instructionsPrompt, loadSpecs, parseSpec, type SpecContext } from "./spec.ts";

const context: SpecContext = { runner: nodeRunner(), terminal: fakeTerminal(), defaultCwd: "/work" };

function parse(frontmatter: string) {
  return parseSpec("agent", "/agents/agent.md", `---\n${frontmatter}\n---\nbody\n`, context);
}

describe("parseSpec", () => {
  it("applies defaults to a minimal spec", () => {
    const spec = parse('schedule: "0 9 * * *"');
    assert.equal(spec.name, "agent");
    assert.equal(spec.file, "/agents/agent.md");
    assert.equal(spec.enabled, true);
    assert.equal(spec.cwd, "/work");
    assert.deepEqual(spec.lifetime, { kind: "bounded", timeoutMilliseconds: 30 * 60_000 });
    assert.deepEqual(spec.runnerOptions, { script: "" });
    assert.deepEqual(spec.terminalOptions, { session: "main" });
  });

  it("reads a timeout for a bounded agent", () => {
    assert.deepEqual(parse('schedule: "0 9 * * *"\ntimeout: 45m').lifetime, { kind: "bounded", timeoutMilliseconds: 45 * 60_000 });
  });

  it("makes a reused agent resident", () => {
    assert.deepEqual(parse('schedule: "0 9 * * *"\nreuse: true').lifetime, { kind: "resident" });
  });

  it("rejects a timeout on a reused agent", () => {
    assert.throws(() => parse('schedule: "0 9 * * *"\nreuse: true\ntimeout: 1h'), /timeout does not apply/);
  });

  it("hands each adapter its own keys", () => {
    const spec = parse('schedule: "0 9 * * *"\nsession: agents\nscript: "process.exit(0)"');
    assert.deepEqual(spec.terminalOptions, { session: "agents" });
    assert.deepEqual(spec.runnerOptions, { script: "process.exit(0)" });
  });

  it("rejects keys no part of the configuration owns", () => {
    assert.throws(() => parse('schedule: "0 9 * * *"\nshedule: typo\nextra: 1'), /unknown frontmatter keys: shedule, extra/);
  });

  it("rejects a missing schedule", () => {
    assert.throws(() => parse("enabled: true"), /schedule/);
  });

  it("rejects a field of the wrong type", () => {
    assert.throws(() => parse('schedule: "0 9 * * *"\nenabled: "no"'), /enabled/);
  });

  it("rejects an invalid cron expression", () => {
    assert.throws(() => parse('schedule: "0 25 * * *"'), /invalid cron field/);
  });

  it("expands a home-relative cwd", () => {
    assert.equal(parse('schedule: "0 9 * * *"\ncwd: ~/projects').cwd, join(homedir(), "projects"));
  });

  it("resolves a relative cwd against the spec's directory", () => {
    assert.equal(parse('schedule: "0 9 * * *"\ncwd: ../work').cwd, "/work");
  });
});

describe("loadSpecs", () => {
  it("loads every Markdown file in name order and reports invalid ones", () => {
    const directory = temporaryDirectory();
    writeSpec(directory, "beta", 'schedule: "0 9 * * *"');
    writeSpec(directory, "alpha", "schedule: nonsense");
    writeFileSync(join(directory, "notes.txt"), "ignored");
    mkdirSync(join(directory, "subdirectory.md.d"));

    const loads = loadSpecs(directory, context);
    assert.deepEqual(
      loads.map((load) => load.kind),
      ["invalid", "loaded"],
    );
    assert.equal(loads[0]?.kind === "invalid" && loads[0].name, "alpha");
    assert.equal(loads[1]?.kind === "loaded" && loads[1].spec.file, join(directory, "beta.md"));
  });
});

describe("instructionsPrompt", () => {
  it("points the agent at its spec file", () => {
    const spec = parse('schedule: "0 9 * * *"');
    assert.match(instructionsPrompt(spec), /Your instructions are in \/agents\/agent\.md\./);
  });
});
