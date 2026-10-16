import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { temporaryDirectory } from "#testing/fakes.ts";
import { acquireSession, isProcessAlive, readLiveSession, releaseSession, type SessionRecord } from "./session.ts";

function exitedPid(): number {
  const { pid } = spawnSync(process.execPath, ["-e", ""]);
  assert.ok(pid);
  return pid;
}

function record(pid: number): SessionRecord {
  return { pid, startedAt: "2026-10-16T09:00:00.000Z", handle: { pane: "1" } };
}

describe("isProcessAlive", () => {
  it("should be true for this process and false for an exited one", () => {
    assert.equal(isProcessAlive(process.pid), true);
    assert.equal(isProcessAlive(exitedPid()), false);
  });
});

describe("acquireSession", () => {
  it("should create a record that readLiveSession returns", () => {
    const directory = temporaryDirectory();

    const isAcquired = acquireSession(directory, "agent", record(process.pid));

    assert.equal(isAcquired, true);
    assert.deepEqual(readLiveSession(directory, "agent"), record(process.pid));
  });

  it("should refuse while a live process holds the record", () => {
    const directory = temporaryDirectory();
    acquireSession(directory, "agent", record(process.pid));

    assert.equal(acquireSession(directory, "agent", record(process.pid + 1)), false);
  });

  it("should reclaim a record left by an exited process", () => {
    const directory = temporaryDirectory();
    acquireSession(directory, "agent", record(exitedPid()));

    const isAcquired = acquireSession(directory, "agent", record(process.pid));

    assert.equal(isAcquired, true);
    assert.equal(readLiveSession(directory, "agent")?.pid, process.pid);
  });

  it("should reclaim an unreadable record", () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "agent.json"), "{not json");

    assert.equal(acquireSession(directory, "agent", record(process.pid)), true);
  });

  it("should leave no temporary files behind", () => {
    const directory = temporaryDirectory();

    acquireSession(directory, "agent", record(process.pid));
    acquireSession(directory, "agent", record(process.pid));

    assert.deepEqual(readdirSync(directory), ["agent.json"]);
  });
});

describe("readLiveSession", () => {
  it("should ignore a record whose process has exited", () => {
    const directory = temporaryDirectory();
    acquireSession(directory, "agent", record(exitedPid()));

    assert.equal(readLiveSession(directory, "agent"), null);
  });
});

describe("releaseSession", () => {
  it("should remove the record its holder owns", () => {
    const directory = temporaryDirectory();
    acquireSession(directory, "agent", record(process.pid));

    releaseSession(directory, "agent", process.pid);

    assert.equal(existsSync(join(directory, "agent.json")), false);
  });

  it("should leave another holder's record alone", () => {
    const directory = temporaryDirectory();
    acquireSession(directory, "agent", record(process.pid));

    releaseSession(directory, "agent", process.pid + 1);

    assert.equal(existsSync(join(directory, "agent.json")), true);
  });

  it("should tolerate a missing record", () => {
    assert.doesNotThrow(() => releaseSession(temporaryDirectory(), "agent", process.pid));
  });
});
