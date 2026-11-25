import type { RenderPropsOf } from "claude-code";
import {
  expect,
  mock,
  test,
  type Mounted,
  type TestBody,
} from "claude-code/testing";

import { shortenCommand, shortenPaths } from "../hooks/register";

type TestDollar = Parameters<TestBody>[0];
type TestOn = Parameters<TestBody>[1];

// MARK: Fixtures

type Row = RenderPropsOf["ToolUse"];

type RowComponent = "ToolUse" | "ToolResult" | "UserMessage";

const BASH_ROW: Row = {
  tool_use_id: "toolu_1",
  tool: "Bash",
  input: { command: 'cd /Users/arya/repo && grep -rn "needle" packages' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: {
    stdout: "a\nb\nc",
    stderr: "Shell cwd was reset to /Users/arya/repo",
    interrupted: false,
  },
};

const longRow = (length: number): Row => ({
  ...BASH_ROW,
  input: { command: "echo " + "x".repeat(length) },
});

const RESULT_PROPS: RenderPropsOf["ToolResult"] = {
  tool_use_id: "toolu_1",
  tool: "Bash",
  output: BASH_ROW.output,
  isErrored: false,
};

const prompt = (isExpanded: boolean): RenderPropsOf["UserMessage"] => ({
  text: "find the costs",
  origin: { kind: "composer" },
  isExpanded,
});

const PANE_PROPS: RenderPropsOf["Pane"] = {
  title: "Tool call",
  isFocused: false,
  bodyColumns: 80,
  placement: "dock",
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
};

function mount<C extends RowComponent>(
  $: TestDollar,
  component: C,
  props: RenderPropsOf[C],
  columns = 200,
) {
  return $.ui.mount({
    plugin: "tool-lines",
    surface: "terminal",
    component,
    props,
    viewport: { columns, rows: 50 },
  });
}

const HOME = "/Users/arya";

// Stands for what the engine draws at any site the mod passes on.
function fakeEngine(on: TestOn) {
  on("ui.render", () => ({ type: "Text", props: {}, children: ["engine"] }));
}

// Stands for the engine's pane registry beneath the mod.
function fakePanes(on: TestOn): Set<string> {
  const open = new Set<string>();
  on("ui.open", ($, e) => {
    open.add(e.id);
    return { value: { isPlaced: true } };
  });
  on("ui.close", ($, e) => {
    open.delete(e.id);
    return { value: undefined };
  });
  answerPanes(on, open);
  return open;
}

// Answers `$.ui.panes()` from a set of open pane ids, as the engine's record does.
function answerPanes(on: TestOn, open: ReadonlySet<string>) {
  on("ui.panes", () => ({
    value: [...open].map((id) => ({
      id,
      title: id,
      isShown: true,
      isFocused: false,
      isPlaced: true,
    })),
  }));
}

// Nested Text children read as one line, the way the terminal paints them.
function shown(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node !== "object" || node === null || !("children" in node))
    return "";
  return Array.isArray(node.children) ? node.children.map(shown).join("") : "";
}

// The hover of each Button in the tree, which the tree keeps beside its props.
function buttonHovers(node: unknown): unknown[] {
  if (typeof node !== "object" || node === null) return [];
  const own =
    "type" in node && node.type === "Button" && "hover" in node
      ? [node.hover]
      : [];
  const children =
    "children" in node && Array.isArray(node.children) ? node.children : [];
  return [...own, ...children.flatMap(buttonHovers)];
}

// The whole row as one line, apart from the dot's column.
async function lineOf(ui: Mounted<"terminal", "ToolUse">): Promise<string> {
  return shown(await ui.drawn()).replace(/^●/, "");
}

async function paneText($: TestDollar): Promise<string> {
  const pane = await $.ui.mount({
    plugin: "tool-lines",
    surface: "terminal",
    component: "Pane",
    requestId: "tool-detail",
    props: PANE_PROPS,
    viewport: { columns: 200, rows: 50 },
  });
  const texts = await pane.findAll({ type: "Text" });
  const codes = await pane.findAll({ type: "Code" });
  await pane.unmount();
  return [...texts.map(shown), ...codes.map((found) => found.text)].join("\n");
}

// MARK: ToolUse

test("draws a tool call as one compact line with its meta", async ($, on) => {
  mock.env(on, { HOME });
  expect(await lineOf(await mount($, "ToolUse", BASH_ROW))).toBe(
    'tool_call: Bash(grep -rn "needle" packages) - shell cwd was reset',
  );
});

test("cuts only the input so the line fits a wide terminal", async ($) => {
  const line = await lineOf(await mount($, "ToolUse", longRow(400), 150));
  expect(line.length).toBe(150 - 4 - 2);
  expect(line).toMatch(/…\) - shell cwd was reset$/);
});

test("lets a narrow terminal wrap to a few rows", async ($) => {
  expect(
    (await lineOf(await mount($, "ToolUse", longRow(400), 60))).length,
  ).toBe(120);
});

test("gives the subject the whole row on a wide terminal", async ($) => {
  expect(await lineOf(await mount($, "ToolUse", longRow(80)))).toContain(
    "x".repeat(80),
  );
});

test("colors the dot yellow while running, green when done, red when errored", async ($) => {
  const dotColor = async (props: Row) =>
    (await (await mount($, "ToolUse", props)).find({ type: "Text", text: "●" }))
      ?.props.color;
  expect(await dotColor({ ...BASH_ROW, isRunning: true })).toBe("warning");
  // Written by the model but not started yet: no result, not flagged running.
  expect(await dotColor({ ...BASH_ROW, output: undefined })).toBe("warning");
  expect(await dotColor(BASH_ROW)).toBe("success");
  expect(await dotColor({ ...BASH_ROW, isErrored: true })).toBe("error");
});

test("leaves running to the dot and marks errored calls", async ($) => {
  const running = await mount($, "ToolUse", {
    ...BASH_ROW,
    isRunning: true,
    output: undefined,
  });
  expect(await lineOf(running)).toBe(
    'tool_call: Bash(grep -rn "needle" packages)',
  );

  const failed = await mount($, "ToolUse", {
    ...BASH_ROW,
    isErrored: true,
    output: "Exit code 1",
  });
  expect(await lineOf(failed)).toMatch(/\) - error$/);
});

test("names a file tool by its path", async ($, on) => {
  mock.env(on, { HOME });
  const ui = await mount($, "ToolUse", {
    ...BASH_ROW,
    tool: "Read",
    input: { file_path: "/Users/arya/notes.md", limit: 20 },
    output: { type: "text" },
  });
  expect(await lineOf(ui)).toBe("tool_call: Read(~/notes.md)");
});

// MARK: UserMessage

test("pads below the prompt so the tool block starts apart from it", async ($, on) => {
  fakeEngine(on);
  const ui = await mount($, "UserMessage", prompt(false));
  const root = await ui.drawn();
  expect(root.type).toBe("Box");
  expect(root.type === "Box" ? root.props?.marginBottom : undefined).toBe(1);
  expect(shown(root)).toBe("engine");
});

// MARK: Expanded view

test("leaves tool rows to the engine while ctrl+o is open", async ($, on) => {
  fakeEngine(on);
  const drawnBy = async <C extends "ToolUse" | "ToolResult">(
    component: C,
    props: RenderPropsOf[C],
  ) => shown(await (await mount($, component, props)).drawn());

  await mount($, "UserMessage", prompt(true));
  expect(await drawnBy("ToolUse", BASH_ROW)).toBe("engine");
  expect(await drawnBy("ToolResult", RESULT_PROPS)).toBe("engine");

  await mount($, "UserMessage", prompt(false));
  expect(await drawnBy("ToolUse", BASH_ROW)).toMatch(/^●tool_call: Bash/);
});

test("a result row that says it is expanded draws in full, with no prompt row seen", async ($, on) => {
  fakeEngine(on);
  // A fresh module, as after a hot reload: no composer prompt has drawn yet.
  const result = await mount($, "ToolResult", {
    ...RESULT_PROPS,
    isExpanded: true,
  });
  expect(shown(await result.drawn())).toBe("engine");
  // The view it reported reaches the tool rows too.
  expect(shown(await (await mount($, "ToolUse", BASH_ROW)).drawn())).toBe(
    "engine",
  );
});

test("a group row the engine draws expanded reports the expanded view", async ($, on) => {
  fakeEngine(on);
  await $.ui.mount({
    plugin: "tool-lines",
    surface: "terminal",
    component: "ToolGroup",
    props: { calls: [], isActive: false, isExpanded: true },
    viewport: { columns: 200, rows: 50 },
  });
  expect(shown(await (await mount($, "ToolUse", BASH_ROW)).drawn())).toBe(
    "engine",
  );
});

// MARK: ToolGroup

test("unfolds a group of reads and searches into one row per call", async ($, on) => {
  let isExpanded: boolean | undefined;
  // Stands in for the engine beneath the mod, recording what it was asked to draw.
  on("ui.render", { component: "ToolGroup" }, async (engine, e) => {
    isExpanded = e.props.isExpanded;
    const { Text } = engine.ui.resolve(e);
    return Text({ children: ["engine"] });
  });
  await $.ui.mount({
    plugin: "tool-lines",
    surface: "terminal",
    component: "ToolGroup",
    props: {
      calls: [
        {
          tool: "Read",
          input: { file_path: "/a.md" },
          isRunning: false,
          isErrored: false,
          isInterrupted: false,
        },
      ],
      isActive: false,
      isExpanded: false,
    },
    viewport: { columns: 200, rows: 50 },
  });
  expect(isExpanded).toBe(true);
});

// MARK: ToolResult

test("hides the result block", async ($) => {
  expect(
    shown(await (await mount($, "ToolResult", RESULT_PROPS)).drawn()),
  ).toBe("");
});

// MARK: Subject

test("drops shell setup so the line starts at the command that does the work", () => {
  expect(
    shortenCommand('T=/private/tmp/x/types/a.d.ts; grep -n "x" $T', HOME),
  ).toBe('grep -n "x" $T');
  expect(shortenCommand("set -e; cd ~/dev/mod && cat a.json", HOME)).toBe(
    "cat a.json",
  );
  expect(shortenCommand("A=1 && B=2; ls", HOME)).toBe("ls");
});

test("stops shell setup at the first command separator", () => {
  expect(shortenCommand("cd site;pwd; ls", HOME)).toBe("pwd; ls");
  expect(shortenCommand("cd a&&b", HOME)).toBe("b");
});

test("keeps a command that is all setup", () => {
  expect(shortenCommand("X=1;", HOME)).toBe("X=1;");
  expect(shortenCommand("cd /tmp &&", HOME)).toBe("cd /tmp &&");
});

test("keeps shell operators outside shortened paths", () => {
  expect(shortenCommand("cat /a/b/c/d>/tmp/log", HOME)).toBe(
    "cat …/c/d>/tmp/log",
  );
  expect(shortenCommand("cat /a/b/c/d|/usr/local/bin/sort", HOME)).toBe(
    "cat …/c/d|…/bin/sort",
  );
  expect(shortenCommand("cat /a/b/c/d;echo /x/y/z/w", HOME)).toBe(
    "cat …/c/d;echo …/z/w",
  );
});

test("writes home as ~ and keeps the last two segments of a long path", () => {
  expect(shortenPaths("/Users/arya/notes.md", HOME)).toBe("~/notes.md");
  expect(
    shortenCommand(
      "cat /private/tmp/claude-501/bundled/types/claude-code.d.ts",
      HOME,
    ),
  ).toBe("cat …/types/claude-code.d.ts");
  expect(shortenPaths("/Users/arya/dev/mod/hooks/register.ts", HOME)).toBe(
    "…/hooks/register.ts",
  );
});

test("writes only the current home as ~", () => {
  expect(shortenCommand("cat /home/alice/a /home/bob/a", "/home/alice")).toBe(
    "cat ~/a …/bob/a",
  );
  expect(shortenCommand("ls /Users/arya2/a", HOME)).toBe("ls …/arya2/a");
  expect(shortenCommand("cat /home/bob/a", undefined)).toBe("cat …/bob/a");
});

test("leaves URLs whole, in a command too", () => {
  expect(
    shortenCommand("https://github.com/Tickloop/claude-mods/tree/main", HOME),
  ).toBe("https://github.com/Tickloop/claude-mods/tree/main");
  expect(
    shortenCommand("curl -s https://example.com/Users/arya/a/b/c/d", HOME),
  ).toBe("curl -s https://example.com/Users/arya/a/b/c/d");
});

test("shortens only the fields that hold a command or a path", async ($, on) => {
  mock.env(on, { HOME });
  const subject = async (tool: string, input: object) =>
    lineOf(await mount($, "ToolUse", { ...BASH_ROW, tool, input }));

  expect(
    await subject("WebFetch", { url: "https://example.com/Users/arya/x" }),
  ).toContain("(https://example.com/Users/arya/x)");
  expect(await subject("Grep", { pattern: "cd src && build" })).toContain(
    "(cd src && build)",
  );
  expect(
    await subject("Read", { file_path: "/Users/arya/dev/a/b/c.md" }),
  ).toContain("(…/b/c.md)");
});

// MARK: Detail pane

test("a click on a tool line's name opens its full call in the side pane", async ($, on) => {
  const panes = fakePanes(on);
  await (await mount($, "ToolUse", BASH_ROW)).press({ key: "detail" });

  expect(panes.has("tool-detail")).toBe(true);
  const text = await paneText($);
  expect(text).toContain('cd /Users/arya/repo && grep -rn "needle" packages');
  expect(text).toContain("a\nb\nc");
  expect(text).toContain("stderr");
});

test("a click on the dot opens the pane too", async ($, on) => {
  const panes = fakePanes(on);
  await (await mount($, "ToolUse", BASH_ROW)).press({ key: "detail-dot" });
  expect(panes.has("tool-detail")).toBe(true);
});

test("only the dot and the name take clicks, never the subject", async ($) => {
  const ui = await mount($, "ToolUse", BASH_ROW);
  const buttons = await ui.findAll({ type: "Button" });
  expect(buttons.map(shown)).toEqual(["●", "tool_call: Bash"]);
});

test("the dot and the name underline together under the pointer", async ($) => {
  const ui = await mount($, "ToolUse", BASH_ROW);
  expect(buttonHovers(await ui.drawn())).toEqual([
    { scope: "open-toolu_1", underline: true },
    { scope: "open-toolu_1", underline: true },
  ]);
});

test("a second click on the same line closes the pane", async ($, on) => {
  const panes = fakePanes(on);
  const ui = await mount($, "ToolUse", BASH_ROW);
  await ui.press({ key: "detail" });
  await ui.press({ key: "detail-dot" });
  expect(panes.has("tool-detail")).toBe(false);

  // Closed, the same line opens it again.
  await ui.press({ key: "detail" });
  expect(panes.has("tool-detail")).toBe(true);
});

const bashOutput = (output: object): Row => ({
  ...BASH_ROW,
  tool_use_id: "toolu_4",
  output,
});

test("shows each Bash stream that printed, and (no output) when neither did", async ($, on) => {
  fakePanes(on);
  const opened = async (row: Row) => {
    const ui = await mount($, "ToolUse", row);
    await ui.press({ key: "detail" });
    const text = await paneText($);
    await ui.press({ key: "detail" });
    return text;
  };

  const stdoutOnly = await opened(bashOutput({ stdout: "built", stderr: "" }));
  expect(stdoutOnly).toContain("stdout");
  expect(stdoutOnly).toContain("built");
  expect(stdoutOnly).not.toContain("stderr");

  const silent = await opened(bashOutput({ stdout: "", stderr: "" }));
  expect(silent).toContain("(no output)");
});

test("shows a result with a stream that is not text as its JSON", async ($, on) => {
  fakePanes(on);
  const row = bashOutput({ stdout: "", stderr: ["warning: skipped files"] });
  await (await mount($, "ToolUse", row)).press({ key: "detail" });

  const text = await paneText($);
  expect(text).toContain("warning: skipped files");
  expect(text).not.toContain("(no output)");
});

test("shows an edit as a diff and a read as numbered file lines", async ($, on) => {
  fakePanes(on);
  const edit = await mount($, "ToolUse", {
    ...BASH_ROW,
    tool_use_id: "toolu_2",
    tool: "Edit",
    input: { file_path: "/a.ts", old_string: "a", new_string: "b" },
    output: {
      filePath: "/a.ts",
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-a", "+b"],
        },
      ],
    },
  });
  await edit.press({ key: "detail" });
  expect(await paneText($)).toContain("@@ -1,1 +1,1 @@\n-a\n+b");

  const readCall = await mount($, "ToolUse", {
    ...BASH_ROW,
    tool_use_id: "toolu_3",
    tool: "Read",
    input: { file_path: "/notes.md" },
    output: {
      type: "text",
      file: {
        filePath: "/notes.md",
        content: "hello",
        numLines: 1,
        startLine: 1,
        totalLines: 1,
      },
    },
  });
  await readCall.press({ key: "detail" });
  expect(await paneText($)).toContain("hello");
});

// MARK: Pane state

const runningRow = (id: string): Row => ({
  ...BASH_ROW,
  tool_use_id: id,
  isRunning: true,
  output: undefined,
});

test("a call that finished before the click shows its result, not running", async ($, on) => {
  fakePanes(on);
  on("tool.call", () => ({
    result: { stdout: "finished", stderr: "", interrupted: false },
  }));
  // The row still carries its running snapshot: the terminal has not redrawn it.
  const ui = await mount($, "ToolUse", runningRow("toolu_done"));
  await $.tool.call({ tool: "Bash", command: "ls", tool_use_id: "toolu_done" });
  await ui.press({ key: "detail" });

  const text = await paneText($);
  expect(text).toContain("finished");
  expect(text).not.toContain("running");
});

test("an open call the row redraws as interrupted reads interrupted in the pane", async ($, on) => {
  fakePanes(on);
  await (
    await mount($, "ToolUse", runningRow("toolu_cut"))
  ).press({
    key: "detail",
  });
  await mount($, "ToolUse", {
    ...runningRow("toolu_cut"),
    isRunning: false,
    isErrored: true,
    isInterrupted: true,
    output: "Interrupted by user",
  });

  const text = await paneText($);
  expect(text).toContain("interrupted");
  expect(text).not.toContain("· error");
});

test("a click on another line while the pane closes leaves that line's call open", async ($, on) => {
  const open = new Set<string>();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  on("ui.open", (_$, e) => {
    open.add(e.id);
    return { value: { isPlaced: true } };
  });
  on("ui.close", async (_$, e) => {
    await gate;
    open.delete(e.id);
    return { value: undefined };
  });
  answerPanes(on, open);
  const a = await mount($, "ToolUse", { ...BASH_ROW, tool_use_id: "toolu_a" });
  const b = await mount($, "ToolUse", {
    ...BASH_ROW,
    tool_use_id: "toolu_b",
    input: { command: "echo second" },
  });
  await a.press({ key: "detail" });

  const closing = a.press({ key: "detail" });
  const opening = b.press({ key: "detail" });
  release?.();
  await Promise.all([closing, opening]);

  expect(open.has("tool-detail")).toBe(true);
  expect(await paneText($)).toContain("echo second");
});

test("a click after a refused open tries to open the pane again", async ($, on) => {
  const open = new Set<string>();
  let refusals = 1;
  on("ui.open", (_$, e) => {
    if (refusals > 0) {
      refusals -= 1;
      return { deny: "not now" };
    }
    open.add(e.id);
    return { value: { isPlaced: true } };
  });
  on("ui.close", (_$, e) => {
    open.delete(e.id);
    return { value: undefined };
  });
  answerPanes(on, open);
  const ui = await mount($, "ToolUse", BASH_ROW);
  await ui.press({ key: "detail" }).catch(() => undefined);
  expect(open.has("tool-detail")).toBe(false);

  await ui.press({ key: "detail" });
  expect(open.has("tool-detail")).toBe(true);
});

test("a refused close keeps the pane's call", async ($, on) => {
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("ui.close", () => ({ deny: "kept open" }));
  answerPanes(on, new Set(["tool-detail"]));
  const ui = await mount($, "ToolUse", BASH_ROW);
  await ui.press({ key: "detail" });
  await ui.press({ key: "detail" }).catch(() => undefined);

  expect(await paneText($)).toContain("needle");
});
