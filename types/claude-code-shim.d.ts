// Loose stand-ins for the Claude Code API the mod uses, so `bun run
// typecheck` and the type-aware lint run with no Claude Code installed. The
// real declarations are generated and never committed: `bun run
// typecheck:mod` checks the mod against them, without this file.
declare module "claude-code" {
  type Next = (e?: any) => Promise<any>;
  export type Hook = (engine: any, e: any, next: Next) => any;
  type Registered = { catch: (hook: Hook) => void };
  export type On = {
    (event: string, hook: Hook): Registered;
    (event: string, matcher: object, hook: Hook): Registered;
  };
  export type Register = (on: On, options: any) => void;
  export const atom: (ref: object, initial: unknown) => any;
  export const read: (engine: any, atom: any) => Promise<any>;
  type Updater = (current: any) => any;
  export const update: (engine: any, atom: any, fn: Updater) => Promise<any>;
  export type CodeProps = {
    source: string;
    language?: string;
    format?: "diff";
    path?: string;
    startLine?: number;
  };
  type Hunk = { oldStart: number; oldLines: number; lines: string[] };
  export interface BuiltinToolResults {
    Edit: {
      structuredPatch: (Hunk & { newStart: number; newLines: number })[];
    };
  }
  export type RenderElement = any;
  export type RenderPropsOf = Record<string, any>;
  export interface PluginState {}
}

declare module "claude-code/testing" {
  import type { On } from "claude-code";
  export type TestBody = (engine: any, on: On) => unknown;
  export type Mounted<_Surface, _Component> = any;
  export const test: (name: string, body: TestBody) => void;
  export const expect: (value: unknown) => any;
}
