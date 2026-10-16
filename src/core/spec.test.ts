import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fakeTerminal, nodeRunner, temporaryDirectory, writeSpec } from "#testing/fakes.ts";
import { minuteMilliseconds } from "./duration.ts";
import { type AgentSpec, instructionsPrompt, LifetimeKind, loadSpecs, parseSpec, type SpecContext, SpecLoadKind } from "./spec.ts";

const context: SpecContext = { runner: nodeRunner(), terminal: fakeTerminal(), defaultCwd: "/work" };

function parse(frontmatter: string): AgentSpec {
  return parseSpec({ name: "agent", file: "/agents/agent.md", text: `---\n${frontmatter}\n---\nbody\n` }, context);
}

describe("parseSpec", () => {
  describe("defaults", () => {
    it("should fill in everything a minimal spec leaves out", () => {
      const spec = parse('schedule: "0 9 * * *"');

      assert.equal(spec.name, "agent");
      assert.equal(spec.file, "/agents/agent.md");
      assert.equal(spec.enabled, true);
      assert.equal(spec.cwd, "/work");
      assert.deepEqual(spec.lifetime, { kind: LifetimeKind.Bounded, timeoutMilliseconds: 30 * minuteMilliseconds });
      assert.deepEqual(spec.runnerOptions, { script: "" });
      assert.deepEqual(spec.terminalOptions, { session: "main" });
    });
  });

  describe("lifetime", () => {
    it("should read a timeout for a bounded agent", () => {
      const spec = parse('schedule: "0 9 * * *"\ntimeout: 45m');

      assert.deepEqual(spec.lifetime, { kind: LifetimeKind.Bounded, timeoutMilliseconds: 45 * minuteMilliseconds });
    });

    it("should make a reused agent resident", () => {
      assert.deepEqual(parse('schedule: "0 9 * * *"\nreuse: true').lifetime, { kind: LifetimeKind.Resident });
    });

    it("should reject a timeout on a reused agent", () => {
      assert.throws(() => parse('schedule: "0 9 * * *"\nreuse: true\ntimeout: 1h'), /timeout does not apply/);
    });

    it("should reject a malformed timeout", () => {
      assert.throws(() => parse('schedule: "0 9 * * *"\ntimeout: soon'), /timeout: invalid duration "soon"/);
    });
  });

  describe("keys", () => {
    it("should hand each adapter its own keys", () => {
      const spec = parse('schedule: "0 9 * * *"\nsession: agents\nscript: "process.exit(0)"');

      assert.deepEqual(spec.terminalOptions, { session: "agents" });
      assert.deepEqual(spec.runnerOptions, { script: "process.exit(0)" });
    });

    it("should reject keys no part of the configuration owns", () => {
      assert.throws(() => parse('schedule: "0 9 * * *"\nshedule: typo\nextra: 1'), /unknown frontmatter keys: shedule, extra/);
    });

    it("should reject a missing schedule", () => {
      assert.throws(() => parse("enabled: true"), /schedule/);
    });

    it("should reject a field of the wrong type", () => {
      assert.throws(() => parse('schedule: "0 9 * * *"\nenabled: "no"'), /enabled/);
    });

    it("should reject an invalid cron expression", () => {
      assert.throws(() => parse('schedule: "0 25 * * *"'), /schedule: invalid cron field/);
    });
  });

  describe("cwd", () => {
    it("should expand a home-relative cwd", () => {
      assert.equal(parse('schedule: "0 9 * * *"\ncwd: ~/projects').cwd, join(homedir(), "projects"));
    });

    it("should resolve a relative cwd against the spec's directory", () => {
      assert.equal(parse('schedule: "0 9 * * *"\ncwd: ../work').cwd, "/work");
    });
  });
});

describe("loadSpecs", () => {
  it("should load every Markdown file in name order and report invalid ones", () => {
    const directory = temporaryDirectory();
    writeSpec(directory, "beta", 'schedule: "0 9 * * *"');
    writeSpec(directory, "alpha", "schedule: nonsense");
    writeFileSync(join(directory, "notes.txt"), "ignored");
    mkdirSync(join(directory, "folder.d"));

    const [alpha, beta, ...rest] = loadSpecs(directory, context);

    assert.equal(rest.length, 0);
    assert.equal(alpha?.kind, SpecLoadKind.Invalid);
    assert.equal(alpha?.kind === SpecLoadKind.Invalid && alpha.name, "alpha");
    assert.equal(beta?.kind === SpecLoadKind.Loaded && beta.spec.file, join(directory, "beta.md"));
  });
});

describe("instructionsPrompt", () => {
  it("should point the agent at its spec file", () => {
    const spec = parse('schedule: "0 9 * * *"');

    assert.match(instructionsPrompt(spec), /Your instructions are in \/agents\/agent\.md\./);
  });
});
