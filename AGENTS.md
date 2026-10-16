# Working on cadence

cadence is a general-purpose tool. Keep it free of assumptions about any one
person's machine, projects, or directory layout.

- `src/core/` knows nothing about a particular terminal, agent CLI, or
  operating system. It talks to them only through the ports in
  `src/core/ports.ts`: a `Terminal`, a `Runner`, and any number of `Gate`s.
- Anything specific to one tool or platform is an adapter in `src/adapters/`.
  An adapter owns its frontmatter keys through its `options` schema; the core
  rejects keys nothing owns.
- `cadence.config.ts` is the one place that picks adapters. Machine-specific
  paths come from `.env`, never from committed files.
- TypeScript, run directly by Node with no build step, so only erasable syntax:
  no enums, namespaces, or parameter properties. Import with `.ts` extensions.
- Before committing, run `npm run typecheck` and `npm test`. Tests live beside
  the code they cover; shared fakes are in `src/testing/fakes.ts`.
- A user-facing change updates the README: CLI usage, frontmatter keys, and
  configuration.
- Commits are lowercase Conventional Commits (`feat:`, `fix:`, `docs:`, …).

Leave the repository clean and committed when you finish: no stray files, no
uncommitted changes, `git status` empty.
