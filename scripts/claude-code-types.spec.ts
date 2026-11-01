// Named .spec.ts, not .test.ts: `claude plugin test .` loads every
// *.test.ts in the mod as a mod test, and this file runs under `bun test`.
import { describe, expect, test } from "bun:test";

import { binaryPath, versionMismatch, versionOf } from "./claude-code-types";

const HEADER = "// Written by Claude Code 2.1.302.\n// Claude Code ...\n";

describe("versionOf", () => {
  test("reads the version from the declarations' header", () => {
    expect(versionOf(HEADER)).toBe("2.1.302");
  });

  test("is null without a header", () => {
    expect(versionOf("declare module 'claude-code' {}")).toBeNull();
  });
});

describe("versionMismatch", () => {
  test("passes the pinned release", () => {
    expect(versionMismatch(HEADER, "2.1.302")).toBeNull();
  });

  test("passes any release when nothing is pinned", () => {
    expect(versionMismatch(HEADER, undefined)).toBeNull();
    expect(versionMismatch(HEADER, "")).toBeNull();
  });

  test("names both versions and the fix for another release", () => {
    const message = versionMismatch(HEADER, "2.1.316");

    expect(message).toContain("Claude Code 2.1.302");
    expect(message).toContain("pins 2.1.316");
    expect(message).toContain("Fix:");
  });

  test("fails declarations with no version when a release is pinned", () => {
    expect(versionMismatch("declare module 'x' {}", "2.1.302")).toContain(
      "of no known version",
    );
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
