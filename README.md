# cadence

Run scheduled coding agents as terminal sessions you can step into.

Each agent is a Markdown file: frontmatter says when and how it runs, and the
body is its instructions. Once a minute, `cadence dispatch` launches every
agent that is due into its own terminal tab, where you can attach and watch or
take over. An agent can stay resident across runs, in which case each later
run is delivered to the same session as a new prompt.

## Requirements

- Node 24 or later
- The terminal and agent CLI your configuration names. The shipped
  configuration runs [Claude Code](https://claude.com/claude-code) in
  [zellij](https://zellij.dev), [tmux](https://github.com/tmux/tmux),
  [iTerm2](https://iterm2.com), [Ghostty](https://ghostty.org) 1.4 or later,
  or macOS Terminal, and gates launches on a macOS machine being fully awake.

## Setup

```sh
npm install
cp .env.example .env    # then fill in your paths
npm test
```

Run `npm run dispatch` (or `node --experimental-strip-types src/cli.ts dispatch`)
once a minute. cadence passes `--experimental-strip-types` everywhere it starts
Node, so a `NODE_OPTIONS` that turns type stripping off cannot break it.

On macOS, fill in `launchd/cadence.plist.template` and load it:

```sh
sed -e "s|{{LABEL}}|local.cadence|" \
    -e "s|{{NODE}}|$(command -v node)|" \
    -e "s|{{REPOSITORY}}|$PWD|" \
    -e "s|{{PATH}}|$PATH|" \
    -e "s|{{LOG_DIRECTORY}}|$HOME/.local/state/cadence/logs|" \
    launchd/cadence.plist.template > ~/Library/LaunchAgents/local.cadence.plist
launchctl load ~/Library/LaunchAgents/local.cadence.plist
```

The `PATH` you bake in is the dispatcher's own, so it must reach your terminal
(`zellij` or `tmux`; the macOS apps need nothing on it). Agents get their
environment from your login shell instead.

## Commands

```
cadence dispatch       launch every agent that is due; run this once a minute
cadence run <agent>    supervise one agent inside the terminal session opened for it
```

You never need `run` yourself: `dispatch` opens a terminal session running it.
It holds the agent's lock, starts the agent CLI, and logs
the start and exit.

## Agent specs

One `<name>.md` per agent in `CADENCE_AGENTS_DIRECTORY`. The agent is told
where its file is and reads the body as its instructions.

```markdown
---
schedule: "30 6 * * 1-5"
zellij: agents
permission-mode: auto
---

# Morning digest

Summarize what happened since yesterday...
```

Core keys:

| Key | | |
|---|---|---|
| `schedule` | required | five-field cron expression, in local time |
| `enabled` | default `true` | `false` stops launches without deleting the agent |
| `cwd` | default `CADENCE_DEFAULT_CWD`, else the state directory | working directory; `~` expands, relative paths resolve from the spec's directory |
| `reuse` | default `false` | `true` keeps one resident session that every later run is delivered to as a prompt; `false` starts a fresh session each run |
| `run-now` | default `false` | `true` launches the agent at the next dispatch whatever its schedule says, then cadence sets it back to `false` |

`CADENCE_TERMINAL` in `.env` picks the terminal agents run in: `zellij` (the
default), `tmux`, `iterm2`, `ghostty`, or `terminal-app`. Each terminal owns
its own keys.

Keys owned by the zellij terminal:

| Key | | |
|---|---|---|
| `zellij` | required | session to open the agent's tab in; it must already be running |

Start the session yourself, from your terminal, and leave it running; cadence
never creates one. A due agent whose session is missing waits, and the dispatch
log says which session to start. Each agent runs through your login shell
(`$SHELL -lic`), exactly like a pane you open by hand, so it sees your full
environment whatever environment the session itself was started with.

Each agent runs as a pane in the tab named after it, so create a `digest` tab
for a `digest.md` agent. Without one, the agent uses the session's first tab.
Either way its pane is stacked with the panes already there, and the tab keeps
your layout whether or not you are attached; cadence never creates or closes
tabs.

Keys owned by the tmux terminal:

| Key | | |
|---|---|---|
| `tmux` | optional | session to open the agent's window in; it must already be running. Without it, the agent gets a session of its own, named after it |

Start tmux yourself and leave its server running; cadence never starts one,
and a due agent waits while no server is up. cadence uses tmux's default
server; for a named one (`tmux -L work`), pass `tmux({ socketName: "work" })`
in `cadence.config.ts`.

Each agent runs in a window named after it, opened in the background so no one
attached is switched to it. A later run splits that window and the old pane is
then closed, so the window keeps its place. An agent without a `tmux` key gets
its own session the first time it runs (`tmux attach -t digest`); cadence marks
that session as the agent's and refuses to use a session of the same name that
it did not create. A finished pane stays, showing how the run ended. Agents run
through your login shell, as with zellij.

iTerm2, Ghostty, and macOS Terminal own no keys. cadence drives them through
AppleScript, so the first time it does, macOS asks whether to let it control
the app; until you allow that (System Settings, Privacy & Security, Automation)
launches fail and are retried each minute. Keep the app running: while it is
not, due agents wait.

Each agent gets a window of its own on its first run. A later run takes the old
session's place in that window, then the old session is closed: iTerm2 and
Ghostty split the old session, and Terminal, which cannot split, opens a window
where the old one was. A finished session stays open, showing how the run
ended, until you press Enter in it (any key, in Ghostty). iTerm2 and Ghostty can take focus when they
open an agent's window, on its first run or after you close it; replacing a
session never does, and Terminal always opens in the background. Ghostty labels the
agent's tab with its name, and Terminal does the same.

Terminal types the agent's command into a new shell, so shell startup files
that start tmux or zellij capture it. The other terminals set
`CADENCE_LAUNCH_ID` before your shell starts, so startup files can skip work
for agents with `[ -z "$CADENCE_LAUNCH_ID" ]`.

Sessions stay open between runs. Without `reuse`, each run replaces the last:
cadence stops the previous session, opens the new one, then closes the old pane,
so the agent always has exactly one open session. With `reuse`, the same
session receives every run, so its conversation carries over. Each run carries
a launch id that cadence checks before closing or prompting a pane, so a pane
that took over an old pane's number after the terminal restarted is left alone.

Keys owned by the Claude Code runner:

| Key | | |
|---|---|---|
| `permission-mode` | optional | passed as `--permission-mode` |
| `model` | optional | passed as `--model` |
| `tools` | optional | list passed as `--allowedTools` |
| `settings` | optional | settings file or JSON passed as `--settings`; `~` expands |
| `add-dir` | optional | list passed as `--add-dir`; `~` expands |

Claude Code asks before working in a directory it has not seen, and a session
waiting on that question looks idle. Open Claude Code once in each agent's
`cwd` and accept it before scheduling the agent. Your home directory is asked
about every time, so never use it as an agent's `cwd`.

Any other key is an error, reported once in the dispatch log.

## How dispatch decides

- An agent seen for the first time is only registered; it never fires
  retroactively.
- An agent with `run-now: true` is due at once, even when seen for the first
  time; while `enabled` is `false` it waits until you enable it. Once the agent
  starts or receives its prompt, cadence rewrites that line to `run-now: false`,
  leaving the rest of the file untouched. Until then, including while the
  agent waits on a gate or the terminal, or its launch keeps failing, it stays
  `true`. This is the only time cadence writes to an agent's file.
- An agent is due when its schedule matched any minute since it was last
  checked, up to a week back. Several missed minutes collapse into one launch.
- If the terminal has no live session to work with, a due agent waits and
  launches once the terminal is back. A launch that fails is retried every
  minute.
- If the agent's previous session is still open, a resident agent receives the
  prompt in that session and any other agent's session is replaced by a fresh
  one. A new session waits up to 30 seconds for the old one to let go.
- Gates run first. While any gate is not ready, nothing launches; the macOS
  gate waits until the machine has been fully awake for a few minutes, so a
  dark wake never starts agents without a network.

State lives in `CADENCE_STATE_DIRECTORY`, logs in `CADENCE_LOG_DIRECTORY`:
`dispatch.log` for launch outcomes and errors, `<agent>.log` for each agent's
starts and exits.

## Configuration

`cadence.config.ts` declares the environment it reads as a zod schema, then
assembles the pieces with factories:

```ts
export default defineConfig({
  environment: z.object({
    CADENCE_AGENTS_DIRECTORY: settingSchema,
    CADENCE_STATE_DIRECTORY: settingSchema,
    // ...
  }),

  create(environment) {
    return {
      agentsDirectory: environment.CADENCE_AGENTS_DIRECTORY,
      // ...
      gates: [macosAwake({ settleMinutes: 5 })],
      terminal: zellij(),
      runner: claude(),
    };
  },
});
```

The shipped configuration builds its terminal from `CADENCE_TERMINAL`. Values
come from the process environment, falling back to `.env` in the repository
root.
A missing required setting stops cadence with the setting named.

To support another terminal, agent CLI, or readiness check, implement the
matching port in `src/core/ports.ts` as an adapter in `src/adapters/` and name
it here.
