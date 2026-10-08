# tool-lines

A [Claude Code](https://code.claude.com) mod that draws each tool call as one compact line and hides its result block. Click a line to see the full call in a side pane.

Forked from the `tool-lines` mod in [Tickloop/claude-mods](https://github.com/Tickloop/claude-mods) by [Pulkit Arya](https://github.com/Tickloop). The compact line is their work. This fork adds the detail pane and shorter subjects.

```
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

## Install

```
/plugin marketplace add fgilio/claude-plugins
/plugin install tool-lines@fgilio
```

Then run `/reload-plugins`.

## Develop

```sh
claude --plugin-dir .
claude plugin validate .
claude plugin test .
```

## Credits

- Original mod: `tool-lines` in [Tickloop/claude-mods](https://github.com/Tickloop/claude-mods), forked at commit [`1042852`](https://github.com/Tickloop/claude-mods/commit/1042852b769b36124ac8718df19710d8027ea1e4).
- The original repository has no license, so this fork has none either. If you are its author and want it changed or taken down, open an issue.
