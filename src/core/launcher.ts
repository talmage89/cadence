import { type Runtime, sessionsDirectory } from "./runtime.ts";
import { readLiveSession, readPreviousSession, type SessionRecord, stopSession } from "./session.ts";
import { type AgentSpec, instructionsPrompt, Lifetime } from "./spec.ts";

export const LaunchOutcome = { Started: "started", Replaced: "replaced", Prompted: "prompted", Busy: "busy" } as const;
export type LaunchOutcome = (typeof LaunchOutcome)[keyof typeof LaunchOutcome];

export function launch(spec: AgentSpec, runtime: Runtime): LaunchOutcome {
  const directory = sessionsDirectory(runtime);
  const liveSession = readLiveSession(directory, spec.name);

  if (liveSession && spec.lifetime === Lifetime.Resident) {
    return promptLiveSession(spec, runtime, liveSession.handle);
  }

  if (liveSession) {
    stopSession(liveSession);
    openSession(spec, runtime, liveSession);
    return LaunchOutcome.Replaced;
  }

  openSession(spec, runtime, readPreviousSession(directory, spec.name));
  return LaunchOutcome.Started;
}

function promptLiveSession(spec: AgentSpec, runtime: Runtime, storedHandle: unknown): LaunchOutcome {
  const { terminal } = runtime;
  const handle = terminal.handle.safeParse(storedHandle);
  if (!handle.success || !terminal.isLive(handle.data)) {
    return LaunchOutcome.Busy;
  }

  terminal.deliver(handle.data, instructionsPrompt(spec));
  return LaunchOutcome.Prompted;
}

function openSession(spec: AgentSpec, runtime: Runtime, sessionToClose: SessionRecord | null): void {
  runtime.terminal.open({
    title: spec.name,
    cwd: spec.cwd,
    command: [...runtime.supervisorCommand, "run", spec.name],
    options: spec.terminalOptions,
  });

  const handle = runtime.terminal.handle.safeParse(sessionToClose?.handle);
  if (handle.success) {
    runtime.terminal.close(handle.data);
  }
}
