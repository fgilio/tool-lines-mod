// Type-level checks, run by both type passes: `bun run typecheck` against
// shim/claude-code.d.ts and `bun run typecheck:mod` against the real
// declarations. Each `@ts-expect-error` fails the pass when its line
// compiles, so the shim cannot drift looser than Claude Code's own types.
import type { On, RenderPropsOf } from "claude-code";

export function hookInputsAreFrozen(on: On): void {
  on("ui.render", { component: "ToolGroup" }, async (_$, e, next) => {
    // @ts-expect-error A hook's `e` is read-only: changed props go to next.
    e.props.isExpanded = true;
    return next(e);
  });
}

export const composerPrompt: RenderPropsOf["UserMessage"]["origin"] = {
  kind: "composer",
};

export const misspeltPrompt: RenderPropsOf["UserMessage"]["origin"] = {
  // @ts-expect-error Prompt origins are a closed set of kinds.
  kind: "composre",
};
