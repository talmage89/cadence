import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { temporaryDirectory } from "../testing/fakes.ts";
import { acquireSession, isProcessAlive, readLiveSession, releaseSession } from "./session.ts";

function deadPid(): number {
  const { pid } = spawnSync(process.execPath, ["-e", ""]);
  assert.ok(pid);
  return pid;
}

function record(pid: number) {
  return { pid, startedAt: "2026-10-16T09:00:00.000Z", handle: { pane: "1" } };
}

describe("isProcessAlive", () => {
  it("is true for this process and false for an exited one", () => {
    assert.equal(isProcessAlive(process.pid), true);
    assert.equal(isProcessAlive(deadPid()), false);
  });
});

describe("acquireSession", () => {
  it("creates a record that readLiveSession returns", () => {
    const directory = temporaryDirectory();
    assert.equal(acquireSession(directory, "agent", record(process.pid)), true);
    assert.deepEqual(readLiveSession(directory, "agent"), record(process.pid));
  });

  it("refuses while a live process holds the record", () => {
    const directory = temporaryDirectory();
    acquireSession(directory, "agent", record(process.pid));
    assert.equal(acquireSession(directory, "agent", record(process.pid + 1)), false);
  });

  it("reclaims a record left by a dead process", () => {
    const directory = temporaryDirectory();
    acquireSession(directory, "agent", record(deadPid()));
    assert.equal(readLiveSession(directory, "agent"), null);
    assert.equal(acquireSession(directory, "agent", record(process.pid)), true);
    assert.equal(readLiveSession(directory, "agent")?.pid, process.pid);
  });

  it("reclaims an unreadable record", () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "agent.json"), "{not json");
    assert.equal(acquireSession(directory, "agent", record(process.pid)), true);
  });

  it("leaves no temporary files behind", () => {
    const directory = temporaryDirectory();
    acquireSession(directory, "agent", record(process.pid));
    acquireSession(directory, "agent", record(process.pid));
    assert.deepEqual(readdirSync(directory), ["agent.json"]);
  });
});

describe("releaseSession", () => {
  it("removes the record its holder owns", () => {
    const directory = temporaryDirectory();
    acquireSession(directory, "agent", record(process.pid));
    releaseSession(directory, "agent", process.pid);
    assert.equal(existsSync(join(directory, "agent.json")), false);
  });

  it("leaves another holder's record alone", () => {
    const directory = temporaryDirectory();
    acquireSession(directory, "agent", record(process.pid));
    releaseSession(directory, "agent", process.pid + 1);
    assert.equal(existsSync(join(directory, "agent.json")), true);
  });

  it("tolerates a missing record", () => {
    assert.doesNotThrow(() => releaseSession(temporaryDirectory(), "agent", process.pid));
  });
});
