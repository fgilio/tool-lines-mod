# tool-lines

A [Claude Code](https://code.claude.com) mod that draws each tool call as one compact line and hides its result block. Click a line to see the full call in a side pane.

Forked from the `tool-lines` mod in [Tickloop/claude-mods](https://github.com/Tickloop/claude-mods) by [Pulkit Arya](https://github.com/Tickloop). The compact line is their work. This fork adds the detail pane and shorter subjects.

```text
● tool_call: Bash(grep -n "x" …/types/claude-code.d.ts)
● tool_call: Read(…/hooks/register.ts)
● tool_call: Edit(~/notes.md) - error
```

## What it does

- **One line per call**: `tool_call: Tool(subject) - meta`. The dot is yellow while the call runs, green when it is done, and red when it fails.
- **Readable subjects**: the line drops shell setup (`T=/path;`, `cd dir &&`, `set -e;`), writes your home folder as `~`, and keeps the last two segments of a long path. The subject uses the whole row.
- **Detail pane**: click a line to open the call's full input and result in a side pane. Bash shows the command, stdout and stderr. Edit and Write show a diff. Read shows the numbered file lines. Other tools show their JSON. Click the same line again to close the pane.
- **ctrl+o**: the expanded transcript stays as the engine draws it.

Clicks reach the mod in the fullscreen terminal.

## Requirements

- Claude Code 2.1.302 or newer. CI runs the mod's tests on 2.1.302.
- The fullscreen terminal, for the clicks that open the detail pane.

## Install

```text
/plugin marketplace add fgilio/claude-plugins
/plugin install tool-lines@fgilio
```

Then run `/reload-plugins`.

## Development

You need [Bun](https://bun.sh) and Claude Code.

```sh
bun install              # the pinned tools, and the pre-commit hook
bun run check            # format, lint, type check, Markdown and the Bun tests
bun run typecheck:mod    # the strict type check, against Claude Code's types
claude plugin test .     # the mod's tests, inside Claude Code
claude plugin validate .
claude --plugin-dir .    # a session with the mod loaded
```

The repository follows the fleet standard in [fgilio/claude-plugins](https://github.com/fgilio/claude-plugins/blob/main/fleet/README.md), with the code profile. A few parts are particular to a mod:

- **Tests**: the tests in `tests/` import `claude-code/testing`, so only `claude plugin test .` runs them, and CI does so in its `mod-tests` job. `bun run test` is `bun test ./scripts`: the Bun tests of the scripts, named `*.spec.ts` because `claude plugin test` loads every `*.test.ts` as a mod test.
- **Types**: the plugin API's declarations come from the Claude Code binary and are never committed. `bun run typecheck:mod` runs `scripts/claude-code-types.ts`, which writes them to the gitignored `.claude-plugin/types/claude-code.d.ts`, then checks the mod with `tsconfig.mod.json`, which has no Node or Bun globals, as in Claude Code. The script runs the binary with no credentials, so it makes no model call. It uses `--claude <path>`, else `$CLAUDE_CODE_BIN`, else the `claude` on your PATH. CI runs it in `mod-tests` on the pinned release.
- **Without Claude Code**: `bun run typecheck` (the fleet's pass, in `bun run check`) types the mod against `types/claude-code-shim.d.ts`, a loose stand-in for the few APIs the mod uses. It catches mistakes in the mod's own code, not misuse of the Claude Code API.
- **A new Claude Code release**: set `CLAUDE_CODE_VERSION` and `CLAUDE_CODE_SHA256` in `.github/workflows/ci.yml` together. `typecheck:mod` fails in CI when the binary's version differs from `CLAUDE_CODE_VERSION`.

## Credits

- Original mod: `tool-lines` in [Tickloop/claude-mods](https://github.com/Tickloop/claude-mods), forked at commit [`1042852`](https://github.com/Tickloop/claude-mods/commit/1042852b769b36124ac8718df19710d8027ea1e4).
- The original repository has no license. This fork is MIT licensed (see [LICENSE](LICENSE)), which covers the changes made here. If you are the original author and want the terms of your part changed or the fork taken down, open an issue.
