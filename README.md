# tool-lines

A Claude Code mod that draws each tool call as one compact line and hides its result block. Click a line to see the full call in a side pane.

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

## Install

```sh
claude plugin marketplace add ~/dev/tool-lines-mod
claude plugin install tool-lines@fgilio-mods
```

Then run `/reload-plugins`. After you change the code, bump `version` in `.claude-plugin/plugin.json` and run `claude plugin update tool-lines@fgilio-mods`.

## Develop

```sh
claude plugin validate .
claude plugin test .
```

## Credits

Forked from `tool-lines` in [Tickloop/claude-mods](https://github.com/Tickloop/claude-mods) (commit `1042852`, by Pulkit Arya). That repo has no license, so ask its author before you publish this fork.
