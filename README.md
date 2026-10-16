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
  configuration uses [zellij](https://zellij.dev) and
  [Claude Code](https://claude.com/claude-code), and gates launches on a macOS
  machine being fully awake.

## Setup

```sh
npm install
cp .env.example .env    # then fill in your paths
npm test
```

Run `node src/cli.ts dispatch` once a minute. On macOS, fill in
`launchd/cadence.plist.template` and load it:

```sh
sed -e "s|{{LABEL}}|local.cadence|" \
    -e "s|{{NODE}}|$(command -v node)|" \
    -e "s|{{REPOSITORY}}|$PWD|" \
    -e "s|{{PATH}}|$PATH|" \
    -e "s|{{LOG_DIRECTORY}}|$HOME/.local/state/cadence/logs|" \
    launchd/cadence.plist.template > ~/Library/LaunchAgents/local.cadence.plist
launchctl load ~/Library/LaunchAgents/local.cadence.plist
```

The `PATH` you bake in is the one agents see when cadence creates their
terminal session, so it must reach your terminal and agent CLI.

## Commands

```
cadence dispatch       launch every agent that is due; run this once a minute
cadence run <agent>    supervise one agent inside the terminal session opened for it
```

You never need `run` yourself: `dispatch` opens a terminal session running it.
It holds the agent's lock, starts the agent CLI, enforces the timeout, and logs
the start and exit.

## Agent specs

One `<name>.md` per agent in `CADENCE_AGENTS_DIRECTORY`. The agent is told
where its file is and reads the body as its instructions.

```markdown
---
schedule: "30 6 * * 1-5"
zellij: agents
permission-mode: auto
timeout: 45m
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
| `reuse` | default `false` | `true` keeps one resident session; later runs are delivered to it as prompts |
| `timeout` | default `30m` | how long a non-resident session may run (`s`, `m`, `h`, `d`); not allowed with `reuse` |

Keys owned by the zellij terminal:

| Key | | |
|---|---|---|
| `zellij` | required | session to open the agent's tab in; created in the background if missing |

Keys owned by the Claude Code runner:

| Key | | |
|---|---|---|
| `permission-mode` | optional | passed as `--permission-mode` |
| `model` | optional | passed as `--model` |
| `tools` | optional | list passed as `--allowedTools` |

Claude Code asks before working in a directory it has not seen, and a session
waiting on that question looks idle. Open Claude Code once in each agent's
`cwd` and accept it before scheduling the agent. Your home directory is asked
about every time, so never use it as an agent's `cwd`.

Any other key is an error, reported once in the dispatch log.

## How dispatch decides

- An agent seen for the first time is only registered; it never fires
  retroactively.
- An agent is due when its schedule matched any minute since it was last
  checked, up to a week back. Several missed minutes collapse into one launch.
- If the terminal has no live session to work with, a due agent waits and
  launches once the terminal is back. A launch that fails is retried every
  minute.
- If the agent's previous session is still running, a resident agent receives
  the prompt in that session; any other agent is skipped until its next
  scheduled time.
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

Values come from the process environment, falling back to `.env` in the
repository root.
A missing required setting stops cadence with the setting named.

To support another terminal, agent CLI, or readiness check, implement the
matching port in `src/core/ports.ts` as an adapter in `src/adapters/` and name
it here.
