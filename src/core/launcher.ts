import { type Runtime, sessionsDirectory } from "./runtime.ts";
import { readLiveSession } from "./session.ts";
import { type AgentSpec, instructionsPrompt, LifetimeKind } from "./spec.ts";

export const LaunchOutcome = { Started: "started", Prompted: "prompted", Busy: "busy" } as const;
export type LaunchOutcome = (typeof LaunchOutcome)[keyof typeof LaunchOutcome];

export function launch(spec: AgentSpec, runtime: Runtime): LaunchOutcome {
  const liveSession = readLiveSession(sessionsDirectory(runtime), spec.name);
  if (liveSession) {
    return promptLiveSession(spec, runtime, liveSession.handle);
  }

  runtime.terminal.open({
    title: spec.name,
    cwd: spec.cwd,
    command: [...runtime.supervisorCommand, "run", spec.name],
    options: spec.terminalOptions,
  });
  return LaunchOutcome.Started;
}

function promptLiveSession(spec: AgentSpec, runtime: Runtime, storedHandle: unknown): LaunchOutcome {
  if (spec.lifetime.kind !== LifetimeKind.Resident) {
    return LaunchOutcome.Busy;
  }

  const { terminal } = runtime;
  const handle = terminal.handle.safeParse(storedHandle);
  if (!handle.success || !terminal.isLive(handle.data)) {
    return LaunchOutcome.Busy;
  }

  terminal.deliver(handle.data, instructionsPrompt(spec));
  return LaunchOutcome.Prompted;
}
