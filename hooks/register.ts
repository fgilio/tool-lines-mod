import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ToolDetail, ToolFacts } from '../types'
import { fieldsOf, inputSections, outputSections, statusOf, type Status } from './detail'

// MARK: Layout

// Wide terminals fit the whole line on one row; narrow ones may wrap, up to MAX_ROWS.
const MIN_CHARS = 120
const MAX_ROWS = 3
// The engine indents transcript rows, so a line sized to the full width would spill onto a second row.
const GUTTER = 4
// The viewport is absent until the terminal has been measured.
const FALLBACK_COLUMNS = 120

// MARK: Row facts

// Input fields that name what a call acts on, most telling first; add a key here to cover a new tool.
const SUBJECT_KEYS = [
  'command',
  'file_path',
  'notebook_path',
  'pattern',
  'url',
  'query',
  'skill',
  'description',
  'path',
  'action',
  'prompt',
]

// Setup the reader skips to find the command that does the work: `T=/long/path;` and `cd dir &&`.
const SHELL_SETUP = /^(?:(?:[A-Za-z_]\w*=\S*|cd\s+\S+|set\s+-\w+)\s*(?:;|&&)\s*)+/
const HOME = /(?:\/Users|\/home)\/[^/\s'"]+/g
// A path past three segments keeps its last two: the folder and the file are what tell it apart.
const LONG_PATH = /(?<![\w:/.~])(?:~|\.{0,2})?(?:\/[^/\s'"]+){3,}/g

export function shortenSubject(subject: string): string {
  return subject
    .replace(SHELL_SETUP, '')
    .replace(HOME, '~')
    .replace(LONG_PATH, path => '…/' + path.split('/').slice(-2).join('/'))
}

// This extracts the main argument of a tool call. Tools with no known key fall back to their raw
// JSON so the line is never blank, and whitespace is collapsed so a multi-line command can't break
// the line apart.
function subjectOf(input: unknown): string {
  const fields = fieldsOf(input)
  if (fields === undefined) return ''
  const key = SUBJECT_KEYS.find(name => typeof fields[name] === 'string' && fields[name] !== '')
  const raw =
    key !== undefined ? String(fields[key]) : Object.keys(fields).length > 0 ? JSON.stringify(fields) : ''
  return shortenSubject(raw.replace(/\s+/g, ' ').trim())
}

// Each probe surfaces one fact the hidden result block would have shown; add one here to extend the meta.
// An errored call's output is the plain text the model read, so only an object carries result fields.
type MetaProbe = (row: ToolFacts, result: Record<string, unknown> | undefined) => string | undefined

const META_PROBES: MetaProbe[] = [
  row => {
    const status = statusOf(row)
    return status === 'interrupted' || status === 'error' ? status : undefined
  },
  (row, result) => (result?.backgroundTaskId !== undefined ? 'background' : undefined),
  (row, result) => (result?.timedOutAfterMs !== undefined ? 'timed out' : undefined),
  (row, result) => {
    const printed = [result?.stdout, result?.stderr]
    return printed.some(stream => typeof stream === 'string' && stream.includes('Shell cwd was reset'))
      ? 'shell cwd was reset'
      : undefined
  },
  (row, result) => {
    const note = result?.returnCodeInterpretation
    return typeof note === 'string' && note !== '' ? note : undefined
  },
]

// MARK: Line

type ToolLine = { subject: string; meta: string }

function clip(text: string, room: number): string {
  if (text.length <= room) return text
  return room <= 1 ? '…' : text.slice(0, room - 1) + '…'
}

// The subject is the only part cut, so the tool name and meta always stay readable.
function lineFor(row: ToolFacts, columns: number): ToolLine {
  // 2 is the dot's column, which the summary text sits beside.
  const width = Math.max(columns - GUTTER - 2, 20)
  const budget = Math.min(Math.max(width, MIN_CHARS), width * MAX_ROWS)
  const result = fieldsOf(row.output)
  const meta = META_PROBES.map(probe => probe(row, result))
    .filter(note => note !== undefined)
    .join(', ')
  const frame = `tool_call: ${row.tool}()`.length + (meta === '' ? 0 : ` - ${meta}`.length)
  return { subject: clip(subjectOf(row.input), budget - frame), meta }
}

// MARK: Status

// The dot alone carries the call's state, so the line needs no "running" text. Theme keys follow
// the person's theme: warning is its yellow, success its green, error its red.
const DOT_COLORS: Record<Status, string> = { interrupted: 'error', error: 'error', running: 'warning', done: 'success' }

const noteStyle = (isError: boolean) => (isError ? { color: 'error' } : { dimColor: true })

// MARK: View

// Tool rows don't say whether the ctrl+o transcript (or --verbose) is open, but the person's own
// prompt rows do; their flag is mirrored here so every tool site leaves that view to the engine.
let isExpandedView = false

function isCompact(surface: string): boolean {
  return surface === 'terminal' && !isExpandedView
}

// MARK: Detail pane

const PANE = 'tool-detail'
const detail = atom({ plugin: 'tool-lines', key: 'detail' } as const, null)

// MARK: Hooks

export const register: Register = on => {
  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'composer' } } }, async ($, e, next) => {
    if (e.surface === 'terminal' && e.props.isExpanded !== isExpandedView) {
      isExpandedView = e.props.isExpanded
      // Tool rows keep their last answer until asked again, so the switch has to redraw them.
      $.ui.invalidate('ui.render')
    }
    if (!isCompact(e.surface)) return next(e)
    const { Box } = $.ui.resolve(e)
    return Box({ flexDirection: 'column', marginBottom: 1, children: [await next(e)] })
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!isCompact(e.surface)) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const line = lineFor(e.props, e.viewport?.columns ?? FALLBACK_COLUMNS)
    const row: ToolDetail = {
      id: e.props.tool_use_id,
      tool: e.props.tool,
      input: e.props.input,
      output: e.props.output,
      isRunning: e.props.isRunning,
      isErrored: e.props.isErrored,
      isInterrupted: e.props.isInterrupted,
    }

    // A second click on the call the pane already shows closes it.
    const toggleDetail = async () => {
      const shown = await update($, detail, current => (current?.id === row.id ? null : row))
      if (shown === null) return $.ui.close({ id: PANE })
      await $.ui.open({ id: PANE, title: `${row.tool} call` })
    }

    return Box({
      flexDirection: 'row',
      marginLeft: 2,
      children: [
        // The dot's own column keeps wrapped rows aligned under the text, as the engine's tool rows do.
        Box({ minWidth: 2, flexShrink: 0, children: [Text({ color: DOT_COLORS[statusOf(e.props)], children: ['●'] })] }),
        Box({
          flexShrink: 1,
          children: [
            Button({
              key: 'detail',
              plain: true,
              onPress: toggleDetail,
              children: [
                Text({
                  wrap: 'wrap',
                  children: [
                    Text({ dimColor: true, children: ['tool_call: '] }),
                    Text({ bold: true, children: [row.tool] }),
                    `(${line.subject})`,
                    ...(line.meta === '' ? [] : [Text({ ...noteStyle(row.isErrored), children: [` - ${line.meta}`] })]),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  })

  // Unfolding hands each grouped read or search to the ToolUse hook, so it flows like every other call.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!isCompact(e.surface)) return next(e)
    return next({ ...e, props: { ...e.props, isExpanded: true } })
  })

  // The compact line already carries what the result block would say.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!isCompact(e.surface)) return next(e)
    const { Box } = $.ui.resolve(e)
    return Box({})
  })

  // A call opened while it ran gets its result once it lands.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const shown = await read($, detail)
    if (shown?.id !== e.tool_use_id) return ran
    const isErrored = ran.deny !== undefined || ran.isError === true
    const output = ran.deny ?? (ran.isError ? ran.text : ran.result)
    await update($, detail, current =>
      current?.id === e.tool_use_id ? { ...current, isRunning: false, isErrored, output } : current,
    )
    return ran
  }).catch(($, e, next) => next(e)) // The pane is a view: a failure here never touches the call.

  // Closed by its close mark or Esc, the next click on the same line opens it again.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, detail, () => null)
    return next(e)
  }).catch(($, e, next) => next(e)) // A failed clear never keeps the pane open.

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Code } = $.ui.resolve(e)
    const shown = await read($, detail)
    if (shown === null) return Text({ dimColor: true, children: ['Click a tool line to see its call here.'] })
    const status = statusOf(shown)
    const sections = [...inputSections(shown), ...outputSections(shown)]

    return Box({
      flexDirection: 'column',
      children: [
        Text({
          children: [
            Text({ bold: true, children: [shown.tool] }),
            Text({ ...noteStyle(status === 'error'), children: [` · ${status}`] }),
          ],
        }),
        ...sections.flatMap(section => [
          Box({ marginTop: 1, children: [Text({ dimColor: true, children: [section.label] })] }),
          Code(section.code),
        ]),
      ],
    })
  })
}
