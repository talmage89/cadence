import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { jsonSchema } from "./validation.ts";

const sessionRecordSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string(),
  handle: z.unknown(),
});

export type SessionRecord = z.output<typeof sessionRecordSchema>;

export function acquireSession(directory: string, name: string, record: SessionRecord): boolean {
  mkdirSync(directory, { recursive: true });
  const file = recordFile(directory, name);

  if (tryCreateRecord(file, record)) {
    return true;
  }

  if (readLiveSession(directory, name)) {
    return false;
  }

  removeFile(file);
  return tryCreateRecord(file, record);
}

export function readLiveSession(directory: string, name: string): SessionRecord | null {
  const record = readRecord(recordFile(directory, name));
  return record !== null && isProcessAlive(record.pid) ? record : null;
}

export function releaseSession(directory: string, name: string, pid: number): void {
  const file = recordFile(directory, name);
  if (readRecord(file)?.pid === pid) {
    renameSync(file, previousRecordFile(directory, name));
  }
}

export function readPreviousSession(directory: string, name: string): SessionRecord | null {
  return readRecord(previousRecordFile(directory, name));
}

export function stopSession(record: SessionRecord): void {
  try {
    process.kill(record.pid, "SIGTERM");
  } catch (error) {
    if (!hasErrorCode(error, "ESRCH")) {
      throw error;
    }
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasErrorCode(error, "EPERM");
  }
}

const recordFileSchema = jsonSchema(sessionRecordSchema);

function recordFile(directory: string, name: string): string {
  return join(directory, `${name}.json`);
}

function previousRecordFile(directory: string, name: string): string {
  return join(directory, `${name}.previous.json`);
}

function tryCreateRecord(file: string, record: SessionRecord): boolean {
  const temporaryFile = `${file}.${record.pid}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify(record)}\n`);

  try {
    linkSync(temporaryFile, file);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      return false;
    }
    throw error;
  } finally {
    removeFile(temporaryFile);
  }
}

function readRecord(file: string): SessionRecord | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }

  const result = recordFileSchema.safeParse(text);
  return result.success ? result.data : null;
}

function removeFile(file: string): void {
  try {
    unlinkSync(file);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
