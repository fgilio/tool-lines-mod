#!/usr/bin/env bun

// Writes .claude-plugin/types/claude-code.d.ts, the plugin API declarations
// `bun run typecheck:mod` checks the mod against, from a Claude Code binary.
// The folder is gitignored: the declarations describe one Claude Code build,
// internals included, so they are generated where they are used.
//
// Claude Code has no command that prints them. It writes them beside the
// bundled plugin-authoring skill each time that skill loads, so the script
// loads the skill with no credentials, in an empty config and temp folder:
// the engine writes the file, then stops at "Not logged in" before any
// model call. The output depends only on the Claude Code version.
//
// Usage: bun scripts/claude-code-types.ts [--claude <path>]
// The binary is --claude, else $CLAUDE_CODE_BIN, else the `claude` on PATH.
// When $CLAUDE_CODE_VERSION is set (CI pins it), a binary of another
// version fails the run.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const ROOT = join(import.meta.dir, "..");

export const TYPES_PATH = ".claude-plugin/types/claude-code.d.ts";

const GENERATED_FILE = "plugin-authoring/types/claude-code.d.ts";

const VERSION_LINE = /^\/\/ Written by Claude Code (\d+\.\d+\.\d+)\.$/m;

/** The Claude Code version named in the declarations' own header. */
export function versionOf(declarations: string): string | null {
  return VERSION_LINE.exec(declarations)?.[1] ?? null;
}

/**
 * Why the declarations do not fit the pinned release, or null when they do
 * or nothing is pinned.
 */
export function versionMismatch(
  declarations: string,
  pinned: string | undefined,
): string | null {
  if (pinned === undefined || pinned === "") return null;
  const version = versionOf(declarations);
  if (version === pinned) return null;

  return (
    `The declarations come from Claude Code ${version ?? "of no known version"}, ` +
    `and CLAUDE_CODE_VERSION pins ${pinned}. ` +
    `Fix: run the pinned binary, or bump CLAUDE_CODE_VERSION and CLAUDE_CODE_SHA256 in .github/workflows/ci.yml together.`
  );
}

/**
 * The binary to start from the temporary folder: a path resolved against
 * the working directory, or a bare command name left for PATH to find.
 */
export function binaryPath(claude: string, cwd: string): string {
  return claude.includes("/") ? resolve(cwd, claude) : claude;
}

/**
 * Loads the plugin-authoring skill in a throwaway session and returns the
 * declarations the engine wrote for it.
 */
async function generate(claude: string): Promise<string> {
  const scratch = await mkdtemp(join(tmpdir(), "claude-code-types-"));

  try {
    // Only what the binary needs to start: no API key, no OAuth token and no
    // config of the person's, so the session cannot log in or spend.
    const child = Bun.spawn([claude, "-p", "/plugin-authoring"], {
      cwd: scratch,
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: scratch,
        CLAUDE_CONFIG_DIR: join(scratch, "config"),
        CLAUDE_CODE_TMPDIR: join(scratch, "tmp"),
        DISABLE_TELEMETRY: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const written = await Array.fromAsync(
      new Bun.Glob(`**/${GENERATED_FILE}`).scan({
        cwd: join(scratch, "tmp"),
        dot: true,
      }),
    );

    if (written.length !== 1) {
      throw new Error(
        `Expected Claude Code to write one ${GENERATED_FILE}, found ${written.length}. ` +
          `Its output: ${(stdout + stderr).trim() || "(none)"}`,
      );
    }

    return await Bun.file(join(scratch, "tmp", written[0] ?? "")).text();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      claude: {
        type: "string",
        default: process.env["CLAUDE_CODE_BIN"] ?? "claude",
      },
    },
  });
  const declarations = await generate(binaryPath(values.claude, process.cwd()));
  const mismatch = versionMismatch(
    declarations,
    process.env["CLAUDE_CODE_VERSION"],
  );

  if (mismatch !== null) {
    console.error(mismatch);

    return 1;
  }

  await Bun.write(join(ROOT, TYPES_PATH), declarations);
  console.log(
    `wrote ${TYPES_PATH} from Claude Code ${versionOf(declarations) ?? "of no known version"}`,
  );

  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
