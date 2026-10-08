import type { BuiltinToolResults, CodeProps } from 'claude-code'

import type { ToolFacts } from '../types'

// MARK: Sections

/** One labelled block of the detail pane, drawn as a `Code`. */
export type Section = { label: string; code: CodeProps }

type Hunk = BuiltinToolResults['Edit']['structuredPatch'][number]

type Fields = Record<string, unknown>

export const fieldsOf = (value: unknown): Fields | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : undefined

const json = (value: unknown): string => JSON.stringify(value, null, 2) ?? String(value)

export type Status = 'interrupted' | 'error' | 'running' | 'done'

export function statusOf(call: ToolFacts): Status {
  if (call.isInterrupted) return 'interrupted'
  if (call.isErrored) return 'error'
  // isRunning is false while a call waits its turn or its approval, so only a stored result marks it done.
  if (call.isRunning || call.output === undefined) return 'running'

  return 'done'
}

// MARK: Input

/** A Bash command reads best as shell; every other input as its JSON. */
export function inputSections(call: ToolFacts): Section[] {
  const fields = fieldsOf(call.input)
  if (call.tool === 'Bash' && typeof fields?.command === 'string') {
    const { command, ...rest } = fields
    const sections: Section[] = [{ label: 'Command', code: { source: command, language: 'bash' } }]

    return Object.keys(rest).length === 0
      ? sections
      : [...sections, { label: 'Options', code: { source: json(rest), language: 'json' } }]
  }

  return [{ label: 'Input', code: { source: json(call.input ?? {}), language: 'json' } }]
}

// MARK: Output

function diffOf(hunks: Hunk[]): string {
  return hunks
    .map(hunk => [`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines].join('\n'))
    .join('\n')
}

const isHunkList = (value: unknown): value is Hunk[] =>
  Array.isArray(value) && value.length > 0 && value.every(hunk => Array.isArray(fieldsOf(hunk)?.lines))

/** Each probe reads one result shape; the first that answers wins. Add one here to cover a new tool. */
type OutputProbe = (output: Fields) => Section[] | undefined

const OUTPUT_PROBES: OutputProbe[] = [
  // Bash: its two streams, each only when it printed something.
  output => {
    if (typeof output.stdout !== 'string' && typeof output.stderr !== 'string') return undefined
    const streams: Section[] = []
    if (output.stdout) streams.push({ label: 'stdout', code: { source: String(output.stdout) } })
    if (output.stderr) streams.push({ label: 'stderr', code: { source: String(output.stderr) } })

    return streams.length > 0 ? streams : [{ label: 'Output', code: { source: '(no output)' } }]
  },
  // Edit and Write: the change as a diff, or a new file's whole content.
  output => {
    if (isHunkList(output.structuredPatch)) {
      return [{ label: 'Diff', code: { source: diffOf(output.structuredPatch), format: 'diff' } }]
    }
    if (output.type === 'create' && typeof output.content === 'string') {
      return [{ label: 'Created', code: { source: output.content, path: String(output.filePath ?? '') } }]
    }

    return undefined
  },
  // Read: the file's lines, numbered from where the read started.
  output => {
    const file = fieldsOf(output.file)
    if (typeof file?.content !== 'string') return undefined
    const startLine = typeof file.startLine === 'number' ? file.startLine : 1

    return [
      {
        label: 'File',
        code: typeof file.filePath === 'string'
          ? { source: file.content, path: file.filePath, startLine }
          : { source: file.content, startLine },
      },
    ]
  },
  // Grep and Glob: matched lines, or the file list.
  output => {
    if (typeof output.content === 'string') return [{ label: 'Matches', code: { source: output.content } }]
    if (Array.isArray(output.filenames)) return [{ label: 'Files', code: { source: output.filenames.join('\n') || '(none)' } }]

    return undefined
  },
]

export function outputSections(call: ToolFacts): Section[] {
  const { output } = call
  if (output === undefined) return []
  // An errored, refused or interrupted call carries the text the model read.
  if (typeof output === 'string') return [{ label: call.isErrored ? 'Error' : 'Output', code: { source: output } }]
  const fields = fieldsOf(output) ?? {}
  for (const probe of OUTPUT_PROBES) {
    const sections = probe(fields)
    if (sections !== undefined) return sections
  }

  return [{ label: 'Output', code: { source: json(output), language: 'json' } }]
}
