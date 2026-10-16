import { homedir } from "node:os";

export function expandHome(path: string): string {
  return path.replace(/^~(?=\/|$)/, homedir());
}
