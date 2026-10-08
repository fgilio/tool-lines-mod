import type { ToolDetail } from '../types'

// MARK: Sections

/** One labelled block of the detail pane, drawn as a `Code`. */
export type Section = {
  label: string
  source: string
  language?: string
  path?: string
  startLine?: number
  format?: 'diff'
}

type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

type Fields = Record<string, unknown>

const fieldsOf = (value: unknown): Fields | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : undefined

const json = (value: unknown): string => JSON.stringify(value, null, 2) ?? String(value)

export function statusOf(detail: ToolDetail): string {
  if (detail.isInterrupted) return 'interrupted'
  if (detail.isErrored) return 'error'
  if (detail.isRunning || detail.output === undefined) return 'running'

  return 'done'
}

// MARK: Input

/** A Bash command reads best as shell; every other input as its JSON. */
export function inputSections(detail: ToolDetail): Section[] {
  const fields = fieldsOf(detail.input)
  if (detail.tool === 'Bash' && typeof fields?.command === 'string') {
    const { command, ...rest } = fields
    const sections: Section[] = [{ label: 'Command', source: command, language: 'bash' }]

    return Object.keys(rest).length === 0 ? sections : [...sections, { label: 'Options', source: json(rest), language: 'json' }]
  }

  return [{ label: 'Input', source: json(detail.input ?? {}), language: 'json' }]
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
type OutputProbe = (output: Fields, detail: ToolDetail) => Section[] | undefined

const OUTPUT_PROBES: OutputProbe[] = [
  // Bash: its two streams, each only when it printed something.
  output => {
    if (typeof output.stdout !== 'string' && typeof output.stderr !== 'string') return undefined
    const streams: Section[] = []
    if (output.stdout) streams.push({ label: 'stdout', source: String(output.stdout) })
    if (output.stderr) streams.push({ label: 'stderr', source: String(output.stderr) })

    return streams.length > 0 ? streams : [{ label: 'Output', source: '(no output)' }]
  },
  // Edit and Write: the change as a diff, or a new file's whole content.
  output => {
    if (isHunkList(output.structuredPatch)) return [{ label: 'Diff', source: diffOf(output.structuredPatch), format: 'diff' }]
    if (output.type === 'create' && typeof output.content === 'string') {
      return [{ label: 'Created', source: output.content, path: String(output.filePath ?? '') }]
    }

    return undefined
  },
  // Read: the file's lines, numbered from where the read started.
  output => {
    const file = fieldsOf(output.file)
    if (typeof file?.content !== 'string') return undefined

    return [
      {
        label: 'File',
        source: file.content,
        path: typeof file.filePath === 'string' ? file.filePath : undefined,
        startLine: typeof file.startLine === 'number' ? file.startLine : 1,
      },
    ]
  },
  // Grep and Glob: matched lines, or the file list.
  output => {
    if (typeof output.content === 'string') return [{ label: 'Matches', source: output.content }]
    if (Array.isArray(output.filenames)) return [{ label: 'Files', source: output.filenames.join('\n') || '(none)' }]

    return undefined
  },
]

export function outputSections(detail: ToolDetail): Section[] {
  const { output } = detail
  if (output === undefined) return []
  // An errored, refused or interrupted call carries the text the model read.
  if (typeof output === 'string') return [{ label: detail.isErrored ? 'Error' : 'Output', source: output }]
  const fields = fieldsOf(output)
  const probed = fields === undefined ? undefined : OUTPUT_PROBES.reduce<Section[] | undefined>((found, probe) => found ?? probe(fields, detail), undefined)

  return probed ?? [{ label: 'Output', source: json(output), language: 'json' }]
}
