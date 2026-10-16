import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function appendLog(file: string, message: string, now: Date = new Date()): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${now.toISOString()} ${message}\n`);
}
