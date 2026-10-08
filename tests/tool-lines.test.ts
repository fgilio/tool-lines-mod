import { expect, test, type TestBody } from 'claude-code/testing'

import { shortenSubject } from '../hooks/register'

// MARK: Fixtures

const BASH_ROW = {
  tool_use_id: 'toolu_1',
  tool: 'Bash',
  input: { command: 'cd /Users/arya/repo && grep -rn "needle" packages' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: { stdout: 'a\nb\nc', stderr: 'Shell cwd was reset to /Users/arya/repo', interrupted: false },
}

// Nested Text children read as one line, the way the terminal paints them.
function shown(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node !== 'object' || node === null) return ''
  const children = (node as { children?: unknown[] }).children ?? []
  return children.map(shown).join('')
}

// The outermost Text holding the summary, apart from the dot's column.
async function lineOf(ui: { find: (query: { type: string; text: RegExp }) => Promise<unknown> }): Promise<string> {
  return shown(await ui.find({ type: 'Text', text: /tool_call|\(/ }))
}

// MARK: ToolUse

test('draws a tool call as one compact line with its meta', async $ => {
  const ui = await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'ToolUse',
    props: BASH_ROW,
    viewport: { columns: 200, rows: 50 },
  })
  expect(await lineOf(ui)).toBe('tool_call: Bash(grep -rn "needle" packages) - shell cwd was reset')
})

test('cuts only the input so the line fits a wide terminal', async $ => {
  const long = { ...BASH_ROW, input: { command: 'echo ' + 'x'.repeat(400) } }
  const ui = await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'ToolUse',
    props: long,
    viewport: { columns: 150, rows: 50 },
  })
  const line = await lineOf(ui)
  expect(line.length).toBe(150 - 4 - 2)
  expect(line).toMatch(/…\) - shell cwd was reset$/)
})

test('lets a narrow terminal wrap to a few rows', async $ => {
  const long = { ...BASH_ROW, input: { command: 'echo ' + 'x'.repeat(400) } }
  const ui = await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'ToolUse',
    props: long,
    viewport: { columns: 60, rows: 40 },
  })
  expect((await lineOf(ui)).length).toBe(120)
})

test('colors the dot yellow while running, green when done, red when errored', async $ => {
  const dotColor = async (props: typeof BASH_ROW) => {
    const ui = await $.ui.mount({
      plugin: 'tool-lines',
      surface: 'terminal',
      component: 'ToolUse',
      props,
      viewport: { columns: 200, rows: 50 },
    })
    return (await ui.find({ type: 'Text', text: '●' }))?.props.color
  }
  expect(await dotColor({ ...BASH_ROW, isRunning: true })).toBe('warning')
  // Written by the model but not started yet: no result, not flagged running.
  expect(await dotColor({ ...BASH_ROW, output: undefined } as never)).toBe('warning')
  expect(await dotColor(BASH_ROW)).toBe('success')
  expect(await dotColor({ ...BASH_ROW, isErrored: true })).toBe('error')
})

test('leaves running to the dot and marks errored calls', async $ => {
  const running = await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...BASH_ROW, isRunning: true, output: undefined },
    viewport: { columns: 200, rows: 50 },
  })
  expect(await lineOf(running)).toBe('tool_call: Bash(grep -rn "needle" packages)')

  const failed = await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...BASH_ROW, isErrored: true, output: 'Exit code 1' },
    viewport: { columns: 200, rows: 50 },
  })
  expect(await lineOf(failed)).toMatch(/\) - error$/)
})

test('names a file tool by its path', async $ => {
  const ui = await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'ToolUse',
    props: {
      ...BASH_ROW,
      tool: 'Read',
      input: { file_path: '/Users/arya/notes.md', limit: 20 },
      output: { type: 'text' },
    },
    viewport: { columns: 200, rows: 50 },
  })
  expect(await lineOf(ui)).toBe('tool_call: Read(~/notes.md)')
})

// MARK: UserMessage

test('pads below the prompt so the tool block starts apart from it', async ($, on) => {
  // Stands for what the engine draws at any site the mod passes on.
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  const ui = await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'find the costs', origin: { kind: 'composer' }, isExpanded: false },
    viewport: { columns: 200, rows: 50 },
  } as never)
  const root = (await ui.drawn()) as { type: string; props?: { marginBottom?: number } }
  expect(root.type).toBe('Box')
  expect(root.props?.marginBottom).toBe(1)
  expect(shown(root)).toBe('engine')
})

// MARK: Expanded view

test('leaves tool rows to the engine while ctrl+o is open', async ($, on) => {
  // Stands for what the engine draws at any site the mod passes on.
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  const mountOn = (component: 'UserMessage' | 'ToolUse' | 'ToolResult', props: object) =>
    $.ui.mount({ plugin: 'tool-lines', surface: 'terminal', component, props, viewport: { columns: 200, rows: 50 } } as never)
  const prompt = { text: 'find the costs', origin: { kind: 'composer' } }

  await mountOn('UserMessage', { ...prompt, isExpanded: true })
  expect(shown(await (await mountOn('ToolUse', BASH_ROW)).drawn())).toBe('engine')
  const result = { tool_use_id: 'toolu_1', tool: 'Bash', output: BASH_ROW.output, isErrored: false }
  expect(shown(await (await mountOn('ToolResult', result)).drawn())).toBe('engine')

  await mountOn('UserMessage', { ...prompt, isExpanded: false })
  expect(shown(await (await mountOn('ToolUse', BASH_ROW)).drawn())).toMatch(/^●tool_call: Bash/)
})

// MARK: ToolGroup

test('unfolds a group of reads and searches into one row per call', async ($, on) => {
  let isExpanded: boolean | undefined
  // Stands in for the engine beneath the mod, recording what it was asked to draw.
  on('ui.render', { component: 'ToolGroup' }, async ($, e) => {
    isExpanded = e.props.isExpanded
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['engine'] })
  })
  await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'ToolGroup',
    props: {
      calls: [{ tool: 'Read', input: { file_path: '/a.md' }, isRunning: false, isErrored: false, isInterrupted: false }],
      isActive: false,
      isExpanded: false,
    },
    viewport: { columns: 200, rows: 50 },
  })
  expect(isExpanded).toBe(true)
})

// MARK: ToolResult

test('hides the result block', async $ => {
  const ui = await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'toolu_1', tool: 'Bash', output: BASH_ROW.output, isErrored: false },
    viewport: { columns: 200, rows: 50 },
  })
  expect(shown(await ui.drawn())).toBe('')
})

// MARK: Subject

test('drops shell setup so the line starts at the command that does the work', () => {
  expect(shortenSubject('T=/private/tmp/x/types/a.d.ts; grep -n "x" $T')).toBe('grep -n "x" $T')
  expect(shortenSubject('set -e; cd ~/dev/mod && cat a.json')).toBe('cat a.json')
  expect(shortenSubject('A=1 && B=2; ls')).toBe('ls')
})

test('writes home as ~ and keeps the last two segments of a long path', () => {
  expect(shortenSubject('/Users/arya/notes.md')).toBe('~/notes.md')
  expect(shortenSubject('cat /private/tmp/claude-501/bundled/types/claude-code.d.ts')).toBe('cat …/types/claude-code.d.ts')
  expect(shortenSubject('/Users/arya/dev/mod/hooks/register.ts')).toBe('…/hooks/register.ts')
})

test('leaves URLs whole', () => {
  expect(shortenSubject('https://github.com/Tickloop/claude-mods/tree/main')).toBe('https://github.com/Tickloop/claude-mods/tree/main')
})

test('gives the subject the whole row on a wide terminal', async $ => {
  const long = { ...BASH_ROW, input: { command: 'echo ' + 'x'.repeat(80) } }
  const ui = await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'ToolUse',
    props: long,
    viewport: { columns: 200, rows: 50 },
  })
  expect(await lineOf(ui)).toContain('x'.repeat(80))
})

// MARK: Detail pane

const PANE_PROPS = { bodyColumns: 80, bodyRows: 40, isFocused: false } as never

type TestOn = Parameters<TestBody>[1]

// Stands for the engine's pane registry beneath the mod.
function fakePanes(on: TestOn): Set<string> {
  const open = new Set<string>()
  on('ui.open', ($, e) => {
    open.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  return open
}

async function paneText($: Parameters<TestBody>[0]): Promise<string> {
  const pane = await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'tool-detail',
    props: PANE_PROPS,
    viewport: { columns: 200, rows: 50 },
  })
  const texts = await pane.findAll({ type: 'Text' })
  const codes = await pane.findAll({ type: 'Code' })
  await pane.unmount()
  return [...texts.map(found => shown(found)), ...codes.map(found => String((found as { props: { source?: string } }).props.source))].join('\n')
}

test('a click on a tool line opens its full call in the side pane', async ($, on) => {
  const panes = fakePanes(on)
  const ui = await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'toolu_1',
    props: BASH_ROW,
    viewport: { columns: 200, rows: 50 },
  })
  await ui.press({ key: 'detail' })

  expect(panes.has('tool-detail')).toBe(true)
  const text = await paneText($)
  expect(text).toContain('cd /Users/arya/repo && grep -rn "needle" packages')
  expect(text).toContain('a\nb\nc')
  expect(text).toContain('stderr')
})

test('a second click on the same line closes the pane', async ($, on) => {
  const panes = fakePanes(on)
  const ui = await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'toolu_1',
    props: BASH_ROW,
    viewport: { columns: 200, rows: 50 },
  })
  await ui.press({ key: 'detail' })
  await ui.press({ key: 'detail' })
  expect(panes.has('tool-detail')).toBe(false)

  // Closed, the same line opens it again.
  await ui.press({ key: 'detail' })
  expect(panes.has('tool-detail')).toBe(true)
})

test('shows an edit as a diff and a read as numbered file lines', async ($, on) => {
  fakePanes(on)
  const edit = await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'ToolUse',
    props: {
      ...BASH_ROW,
      tool_use_id: 'toolu_2',
      tool: 'Edit',
      input: { file_path: '/a.ts', old_string: 'a', new_string: 'b' },
      output: { filePath: '/a.ts', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] },
    },
    viewport: { columns: 200, rows: 50 },
  })
  await edit.press({ key: 'detail' })
  expect(await paneText($)).toContain('@@ -1,1 +1,1 @@\n-a\n+b')

  const readCall = await $.ui.mount({
    plugin: 'tool-lines',
    surface: 'terminal',
    component: 'ToolUse',
    props: {
      ...BASH_ROW,
      tool_use_id: 'toolu_3',
      tool: 'Read',
      input: { file_path: '/notes.md' },
      output: { type: 'text', file: { filePath: '/notes.md', content: 'hello', numLines: 1, startLine: 1, totalLines: 1 } },
    },
    viewport: { columns: 200, rows: 50 },
  })
  await readCall.press({ key: 'detail' })
  expect(await paneText($)).toContain('hello')
})
