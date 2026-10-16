import { type Runtime, sessionsDirectory } from "./runtime.ts";
import { readLiveSession } from "./session.ts";
import { type AgentSpec, instructionsPrompt } from "./spec.ts";

export type LaunchOutcome = { kind: "started" } | { kind: "prompted" } | { kind: "busy" };

function promptLiveSession(spec: AgentSpec, runtime: Runtime, storedHandle: unknown): LaunchOutcome {
  if (spec.lifetime.kind !== "resident") return { kind: "busy" };

  const handle = runtime.terminal.handle.safeParse(storedHandle);
  if (!handle.success || !runtime.terminal.isLive(handle.data)) return { kind: "busy" };

  runtime.terminal.deliver(handle.data, instructionsPrompt(spec));
  return { kind: "prompted" };
}

export function launch(spec: AgentSpec, runtime: Runtime): LaunchOutcome {
  const liveSession = readLiveSession(sessionsDirectory(runtime), spec.name);
  if (liveSession) return promptLiveSession(spec, runtime, liveSession.handle);

  runtime.terminal.open({
    title: spec.name,
    cwd: spec.cwd,
    command: [...runtime.supervisorCommand, "run", spec.name],
    options: spec.terminalOptions,
  });
  return { kind: "started" };
}
