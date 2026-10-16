# Working on cadence

cadence is a general-purpose tool. Keep it free of assumptions about any one
person's machine, projects, or directory layout.

- `src/core/` knows nothing about a particular terminal, agent CLI, or
  operating system. It talks to them only through the ports in
  `src/core/ports.ts`: a `Terminal`, a `Runner`, and any number of `Gate`s.
- Anything specific to one tool or platform is an adapter in `src/adapters/`.
  An adapter owns its frontmatter keys through its `options` schema; the core
  rejects keys nothing owns.
- `cadence.config.ts` is the one place that picks adapters and declares the
  environment it reads. Machine-specific paths come from `.env`, never from
  committed files.
- TypeScript, run directly by Node with no build step, so only erasable syntax:
  no enums, namespaces, or parameter properties. Import with `.ts` extensions.
  Every place that starts Node passes `--experimental-strip-types`, because a
  user's `NODE_OPTIONS` may turn type stripping off.
- Before committing, run `npm run typecheck` and `npm test`. Tests live beside
  the code they cover; shared fakes are in `src/testing/fakes.ts`.
- A user-facing change updates the README: CLI usage, frontmatter keys, and
  configuration.
- Commits are lowercase Conventional Commits (`feat:`, `fix:`, `docs:`, …).

Leave the repository clean and committed when you finish: no stray files, no
uncommitted changes, `git status` empty.

## Code style

Write code that reads the way a careful reviewer would leave it. A pass that
only restyles must leave behavior identical; a bug found along the way is
reported, not folded in.

**Parsing.** Anything read from outside the program goes through zod: files,
JSON, YAML, environment variables, CLI arguments, and other programs' output.
Parse once at the boundary into a typed value and pass that inward.
`parseOrThrow` and `jsonSchema` in `src/core/validation.ts` cover the common
cases. Derive types from schemas (`z.output<typeof fooSchema>`) instead of
declaring them twice.

**Names.** Full descriptive identifiers everywhere, callback parameters
included: `(session) => …`, never `(s) => …`. A name states what the thing is
for the reader, not where it came from. Booleans read as predicates (`is…`,
`has…`, `should…`), and a condition worth reading is worth naming. Schemas are
camelCase `…Schema` constants. Options objects are `…Params`. A file is named
for what it holds, not the act it performs: `launcher.ts`, not `launch.ts`.

**Magic values.** No bare strings or numbers with meaning. Hoist them to named
constants, and model closed sets with the const-object idiom, which replaces
`enum` here:

```ts
export const LaunchOutcome = { Started: "started", Busy: "busy" } as const;
export type LaunchOutcome = (typeof LaunchOutcome)[keyof typeof LaunchOutcome];
```

Prefer that over a bare string-literal union, even a fully typed one. Durations
build on the units in `src/core/duration.ts`.

**Control flow.** Early returns over nesting, and never a nested ternary. Every
`if` takes braces, a one-line `return` or `throw` included, and consecutive
early returns get a blank line between them. Extract a dense block into a
function named for its intent. More than three positional parameters become a
params object. Destructure once instead of repeating `foo.bar.…`. Blank lines
paragraph a function, usually including one before the final `return`.

**Types.** No type assertions (`as`). Restructure until the types prove
themselves, or parse with zod. Exported functions declare their return types.
Compare with `!== null` where a falsy value would be legitimate.

**Placement.** Each file reads like a newspaper: imports in one block, then the
exported API, then private helpers in the order they are called, so the top of
the file summarizes it. Module-level helpers are `function` declarations, so
they can sit below their callers. A constant with one reader sits beside that
reader rather than at the top of the file. Cross-directory imports go through
the `#core/`, `#adapters/`, and `#testing/` aliases; `./` is for siblings, and
`../` is never used.

**Comments.** Self-explanatory code over comments. No narration, section
dividers, commented-out code, or TODOs. A port's contract earns a short doc
comment where the method name alone would mislead; implementations stay bare.
Anything that survives is at most three lines and says why, not what.

**Tests.** Test behavior and contracts, not implementation. `describe` names
the subject and nests by concern; each case reads `it("should …")`. Arrange,
act, and assert are separate paragraphs. A comment stating a scenario's
non-obvious premise is welcome in a test.
