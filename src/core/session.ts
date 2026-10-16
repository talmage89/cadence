import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const sessionRecordSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string(),
  handle: z.unknown(),
});

export type SessionRecord = z.output<typeof sessionRecordSchema>;

function recordFile(directory: string, name: string): string {
  return join(directory, `${name}.json`);
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrorWithCode(error, "EPERM");
  }
}

function readRecord(file: string): SessionRecord | null {
  try {
    const result = sessionRecordSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function removeFile(file: string): void {
  try {
    unlinkSync(file);
  } catch (error) {
    if (!isErrorWithCode(error, "ENOENT")) throw error;
  }
}

function tryCreateRecord(file: string, record: SessionRecord): boolean {
  const temporaryFile = `${file}.${record.pid}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify(record)}\n`);

  try {
    linkSync(temporaryFile, file);
    return true;
  } catch (error) {
    if (isErrorWithCode(error, "EEXIST")) return false;
    throw error;
  } finally {
    removeFile(temporaryFile);
  }
}

export function readLiveSession(directory: string, name: string): SessionRecord | null {
  const record = readRecord(recordFile(directory, name));
  return record && isProcessAlive(record.pid) ? record : null;
}

export function acquireSession(directory: string, name: string, record: SessionRecord): boolean {
  mkdirSync(directory, { recursive: true });
  const file = recordFile(directory, name);

  if (tryCreateRecord(file, record)) return true;
  if (readLiveSession(directory, name)) return false;

  removeFile(file);
  return tryCreateRecord(file, record);
}

export function releaseSession(directory: string, name: string, pid: number): void {
  const file = recordFile(directory, name);
  if (readRecord(file)?.pid === pid) removeFile(file);
}
