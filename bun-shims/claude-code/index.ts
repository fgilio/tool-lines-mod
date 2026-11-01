// What `claude-code` resolves to under `bun test`, so the mod's test file
// loads there. The engine provides the real module, and the mod's tests run
// under `claude plugin test .`. The "bun" export condition keeps tsc on the
// real declarations in types/claude-code.d.ts.

/** Runs when the hooks module loads, so it returns a placeholder. */
export const atom = (ref: unknown, initial: unknown) => ({ ref, initial });

const engineOnly = (name: string) => () => {
  throw new Error(
    `claude-code ${name}() runs only in Claude Code. Run the mod's tests with claude plugin test .`,
  );
};

export const read = engineOnly("read");

export const update = engineOnly("update");
