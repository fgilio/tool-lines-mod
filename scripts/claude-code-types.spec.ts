// Named .spec.ts, not .test.ts: `claude plugin test .` loads every
// *.test.ts in the mod as a mod test, and this file runs under `bun test`.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  LINT_HEADER,
  TYPES_PATH,
  binaryPath,
  pinnedVersion,
  versionOf,
  withLintHeader,
} from "./claude-code-types";

const ROOT = join(import.meta.dir, "..");

const read = (path: string) => Bun.file(join(ROOT, path)).text();

describe("versionOf", () => {
  test("reads the version from the declarations' header", () => {
    expect(
      versionOf("// Written by Claude Code 2.1.302.\n// Claude Code ..."),
    ).toBe("2.1.302");
  });

  test("finds the header below the lint header", () => {
    expect(
      versionOf(withLintHeader("// Written by Claude Code 2.1.316.\n")),
    ).toBe("2.1.316");
  });

  test("is null without a header", () => {
    expect(versionOf("declare module 'claude-code' {}")).toBeNull();
  });
});

describe("pinnedVersion", () => {
  test("reads CLAUDE_CODE_VERSION from a workflow", () => {
    expect(pinnedVersion("env:\n  CLAUDE_CODE_VERSION: 2.1.302\n")).toBe(
      "2.1.302",
    );
  });

  test("is null when the workflow pins no version", () => {
    expect(pinnedVersion("env:\n  OTHER: 1\n")).toBeNull();
  });
});

describe("binaryPath", () => {
  test("resolves a relative path against the working directory", () => {
    expect(binaryPath("./bin/claude", "/work")).toBe("/work/bin/claude");
  });

  test("keeps an absolute path", () => {
    expect(binaryPath("/opt/claude", "/work")).toBe("/opt/claude");
  });

  test("leaves a bare command name to PATH", () => {
    expect(binaryPath("claude", "/work")).toBe("claude");
  });
});

describe(TYPES_PATH, () => {
  test("opens with the lint header", async () => {
    expect((await read(TYPES_PATH)).split("\n", 1)[0]).toBe(LINT_HEADER);
  });

  test("comes from the Claude Code release CI runs the mod's tests on", async () => {
    const pinned = pinnedVersion(await read(".github/workflows/ci.yml"));

    expect(pinned).not.toBeNull();
    expect(versionOf(await read(TYPES_PATH))).toBe(pinned);
  });
});
