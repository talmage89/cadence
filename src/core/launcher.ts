import type { z } from "zod";
import { type Runtime, sessionsDirectory } from "./runtime.ts";
import { readLiveSession, readOpenedHandle, recordOpenedHandle, stopSession } from "./session.ts";
import { type AgentSpec, instructionsPrompt, Lifetime } from "./spec.ts";

export const LaunchOutcome = { Started: "started", Replaced: "replaced", Prompted: "prompted", Busy: "busy" } as const;
export type LaunchOutcome = (typeof LaunchOutcome)[keyof typeof LaunchOutcome];

export function launch(spec: AgentSpec, runtime: Runtime): LaunchOutcome {
  const directory = sessionsDirectory(runtime);
  const liveSession = readLiveSession(directory, spec.name);
  const openedHandle = runtime.terminal.handle.safeParse(readOpenedHandle(directory, spec.name));

  if (liveSession && spec.lifetime === Lifetime.Resident) {
    return promptLiveSession(spec, runtime, openedHandle);
  }

  if (liveSession) {
    stopSession(liveSession);
    openSession(spec, runtime, openedHandle);
    return LaunchOutcome.Replaced;
  }

  openSession(spec, runtime, openedHandle);
  return LaunchOutcome.Started;
}

type OpenedHandle = z.ZodSafeParseResult<unknown>;

function promptLiveSession(spec: AgentSpec, runtime: Runtime, openedHandle: OpenedHandle): LaunchOutcome {
  const { terminal } = runtime;
  if (!openedHandle.success || !terminal.isLive(openedHandle.data)) {
    return LaunchOutcome.Busy;
  }

  terminal.deliver(openedHandle.data, instructionsPrompt(spec));
  return LaunchOutcome.Prompted;
}

function openSession(spec: AgentSpec, runtime: Runtime, openedHandle: OpenedHandle): void {
  const { terminal } = runtime;
  const handle = terminal.open({
    title: spec.name,
    cwd: spec.cwd,
    command: [...runtime.supervisorCommand, "run", spec.name],
    options: spec.terminalOptions,
    replacing: openedHandle.success ? openedHandle.data : null,
  });
  recordOpenedHandle(sessionsDirectory(runtime), spec.name, handle);

  if (openedHandle.success) {
    terminal.close(openedHandle.data);
  }
}
