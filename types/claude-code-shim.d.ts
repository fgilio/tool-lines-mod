// The Claude Code API the mod and its tests use, so `bun run typecheck` and
// the type-aware lint run with no Claude Code installed. Each shape copies
// the real declaration, narrowed to the members the mod touches. The real
// declarations are generated and never committed: `bun run typecheck:mod`
// checks the mod against them, without this file.
declare module "claude-code" {
  // MARK: State

  export interface PluginState {}

  type StateKey<P extends keyof PluginState> = keyof PluginState[P] & string;

  export type Atom<T> = { readonly initial: T };

  const opaque: unique symbol;

  /** A value the mod passes through and never reads inside. */
  type Opaque<Name extends string> = { readonly [opaque]: Name };

  export type StateDollar = Pick<EngineInterface, "state">;

  export const atom: <P extends keyof PluginState, K extends StateKey<P>>(
    ref: { readonly plugin: P; readonly key: K },
    initial: PluginState[P][K],
  ) => Atom<PluginState[P][K]>;
  export const read: <T>($: StateDollar, source: Atom<T>) => Promise<T>;
  export const update: <T>(
    $: StateDollar,
    target: Atom<T>,
    change: (value: T) => T,
  ) => Promise<T>;

  // MARK: Elements

  export type Space = number | "xs" | "sm" | "md" | "lg" | "xl";

  export type BoxProps = {
    key?: string;
    flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
    flexShrink?: number;
    minWidth?: number | string;
    marginTop?: Space;
    marginBottom?: Space;
    marginLeft?: Space;
  };

  export type TextProps = {
    color?: string;
    dimColor?: boolean;
    bold?: boolean;
    wrap?:
      | "wrap"
      | "end"
      | "middle"
      | "truncate"
      | "truncate-start"
      | "truncate-middle"
      | "truncate-end";
  };

  export type ButtonProps = {
    key?: string;
    label?: string;
    plain?: true;
    // Claude Code types it `=> void`, and its own examples return a promise
    // from it. The mod returns the toggle's promise, so the press stays tied
    // to the `$.ui.open` it makes (an open the person asked for).
    onPress: (e: UiPressArgument) => void | Promise<void>;
  };

  export type CodeProps = {
    source: string;
    language?: string;
    path?: string;
    startLine?: number;
    format?: "source" | "diff";
    wrap?: "wrap" | "truncate-end";
  };

  export type UiPressArgument = { plugin: string; element: string };

  export type RenderNode = RenderElement | string;

  export type RenderChildren =
    | RenderNode
    | number
    | boolean
    | null
    | undefined
    | readonly RenderChildren[];

  type StyledElement<Tag extends "Box" | "Text"> = {
    type: Tag;
    props?: Record<string, string | number | boolean>;
    children?: RenderNode[];
  };

  export type RenderElement =
    | StyledElement<"Box">
    | StyledElement<"Text">
    | {
        type: "Button";
        props: { key: string; label: string; plain?: true };
        press: { plugin: string; handle: number };
        children?: RenderNode[];
      }
    | { type: "Code"; props: CodeProps; children?: undefined };

  export type ElementConstructor<P> = (
    props: P & { children?: RenderChildren },
  ) => RenderElement;

  export type ElementTable = {
    Box: ElementConstructor<BoxProps>;
    Text: ElementConstructor<TextProps>;
    Button: ElementConstructor<ButtonProps>;
    Code: ElementConstructor<CodeProps>;
  };

  // MARK: Render

  export type RenderSurface = "terminal" | "desktop" | "vscode" | "mobile";

  export type RenderViewport = {
    columns: number;
    rows: number;
    isFullscreen?: boolean;
  };

  export type PromptOrigin = { kind: string };

  export type ToolGroupCall = {
    tool_use_id?: string;
    tool: string;
    input: unknown;
    isRunning: boolean;
    isErrored: boolean;
    isInterrupted: boolean;
    output?: unknown;
  };

  export type RenderPropsOf = {
    UserMessage: { text: string; origin: PromptOrigin; isExpanded: boolean };
    ToolUse: {
      tool_use_id: string;
      tool: string;
      input: unknown;
      isRunning: boolean;
      isErrored: boolean;
      isInterrupted: boolean;
      isExpanded?: boolean;
      output?: unknown;
    };
    ToolResult: {
      tool_use_id: string;
      tool: string;
      output: unknown;
      isErrored: boolean;
      isExpanded?: boolean;
    };
    ToolGroup: {
      calls: readonly ToolGroupCall[];
      isActive: boolean;
      isExpanded: boolean;
    };
    Pane: {
      title: string;
      isFocused: boolean;
      bodyColumns: number;
      placement: "dock" | "inline";
      scroll: { offset: number; bodyRows: number };
      view: { agentId?: string };
    };
  };

  export type RenderComponent = keyof RenderPropsOf;

  export type RenderInput<C extends RenderComponent = RenderComponent> =
    C extends RenderComponent
      ? {
          surface: RenderSurface;
          component: C;
          requestId: string;
          viewport?: RenderViewport;
          props: RenderPropsOf[C];
        }
      : never;

  export type RenderMatcher<C extends RenderComponent> = {
    readonly component: C;
    readonly requestId?: string;
    readonly props?: Readonly<Partial<RenderPropsOf[C]>>;
  };

  // MARK: Tools

  export type ToolCallInput = { tool: string; tool_use_id: string };

  export type ToolCallResult =
    | {
        deny: string;
        result?: undefined;
        text?: undefined;
        isError?: undefined;
      }
    | { result: unknown; text?: string; isError?: undefined; deny?: undefined }
    | { isError: true; result: unknown; text?: string; deny?: undefined };

  type Hunk = { oldStart: number; oldLines: number; lines: string[] };

  export interface BuiltinToolResults {
    Edit: {
      structuredPatch: (Hunk & { newStart: number; newLines: number })[];
    };
  }

  // MARK: Panes

  export type PaneOpenArgs = { id: string; title?: string };

  export type PaneCloseArgs = { id: string };

  export type PaneCloseInput = PaneCloseArgs & {
    origin: { kind: "plugin" | "person" | "unload" };
  };

  export type UiOpenResult =
    | { isPlaced: true }
    | { isPlaced: false; reason: string };

  type ValueOrDeny<Value> =
    | { value: Value; deny?: undefined }
    | { deny: string; value?: undefined };

  // MARK: Engine

  export interface EngineInterface {
    state: Opaque<"state">;
    ui: {
      invalidate: (event: "ui.render") => void;
      resolve: (e: { surface: RenderSurface }) => ElementTable;
      open: (pane: PaneOpenArgs) => Promise<UiOpenResult>;
      close: (pane: PaneCloseArgs) => Promise<void>;
    };
  }

  // MARK: Hooks

  export type EventOf = {
    "ui.render": RenderInput;
    "tool.call": ToolCallInput;
    "ui.open": PaneOpenArgs;
    "ui.close": PaneCloseInput;
  };

  export type ResultOf = {
    "ui.render": RenderElement;
    "tool.call": ToolCallResult;
    "ui.open": ValueOrDeny<UiOpenResult>;
    "ui.close": ValueOrDeny<void>;
  };

  export type EventName = keyof EventOf;

  export type Next<E, R> = (e: E) => Promise<R>;

  export type Hook<E, R> = (
    $: EngineInterface,
    e: E,
    next: Next<E, R>,
  ) => R | Promise<R>;

  export type Caught = { readonly error: unknown; readonly called: boolean };

  export type CatchHandler<E, R> = (
    $: EngineInterface,
    e: E,
    next: Next<E, R> & Caught,
  ) => R | undefined | Promise<R | undefined>;

  export type Registration<E, R> = {
    readonly catch: (handler: CatchHandler<E, R>) => void;
  };

  export type On = {
    <N extends EventName>(
      event: N,
      hook: Hook<EventOf[N], ResultOf[N]>,
    ): Registration<EventOf[N], ResultOf[N]>;
    <C extends RenderComponent>(
      event: "ui.render",
      matcher: RenderMatcher<C>,
      hook: Hook<RenderInput<C>, RenderElement>,
    ): Registration<RenderInput<C>, RenderElement>;
    (
      event: "ui.close",
      matcher: { readonly id: string },
      hook: Hook<PaneCloseInput, ResultOf["ui.close"]>,
    ): Registration<PaneCloseInput, ResultOf["ui.close"]>;
  };

  export type PluginOptions = Opaque<"options">;

  export type Register = (on: On, options: PluginOptions) => unknown;
}

declare module "claude-code/testing" {
  import type {
    On,
    RenderComponent,
    RenderElement,
    RenderPropsOf,
    RenderSurface,
    RenderViewport,
  } from "claude-code";

  export type FoundElement = {
    type: string;
    key: string | undefined;
    props: Record<string, unknown>;
    text: string;
    children: unknown[];
  };

  export type ElementQuery = {
    type?: string;
    key?: string;
    text?: string | RegExp;
  };

  export type Mounted<
    P extends RenderSurface = RenderSurface,
    _C extends RenderComponent = RenderComponent,
  > = {
    readonly surface: P;
    drawn: () => Promise<RenderElement>;
    find: (query: ElementQuery) => Promise<FoundElement | undefined>;
    findAll: (query: ElementQuery) => Promise<FoundElement[]>;
    press: (target: {
      key: string;
    }) => Promise<{ element: string } | undefined>;
    unmount: () => Promise<void>;
  };

  export type MountTarget<
    P extends RenderSurface,
    C extends RenderComponent,
  > = {
    plugin: string;
    surface: P;
    component: C;
    props: RenderPropsOf[C];
    requestId?: string;
    viewport?: RenderViewport;
  };

  export type Engine = {
    ui: {
      mount: <P extends RenderSurface, C extends RenderComponent>(
        target: MountTarget<P, C>,
      ) => Promise<Mounted<P, C>>;
    };
  };

  export type TestBody = ($: Engine, on: On) => unknown;

  export const test: (name: string, body: TestBody) => void;

  export type Matchers = {
    toBe: (expected: unknown) => void;
    toContain: (item: unknown) => void;
    toMatch: (pattern: string | RegExp) => void;
  };

  export type Expectation = Matchers & { not: Matchers };

  export const expect: (received: unknown, message?: string) => Expectation;
}
