/** The call the detail pane shows, as its row last carried it. */
export type ToolDetail = {
  id: string
  tool: string
  input: unknown
  output?: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
}

/** What a tool row says about its call, apart from its id. */
export type ToolFacts = Omit<ToolDetail, 'id'>

declare module 'claude-code' {
  interface PluginState {
    'tool-lines': { detail: ToolDetail | null }
  }
}
