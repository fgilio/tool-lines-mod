import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { ToolDetail, ToolFacts } from "../types";
import {
  fieldsOf,
  inputSections,
  outputSections,
  statusOf,
  type Status,
} from "./detail";

// MARK: Layout

// Wide terminals fit the whole line on one row; narrow ones may wrap, up to MAX_ROWS.
const MIN_CHARS = 120;
const MAX_ROWS = 3;
// The engine indents transcript rows, so a line sized to the full width would spill onto a second row.
const GUTTER = 4;
// The viewport is absent until the terminal has been measured.
const FALLBACK_COLUMNS = 120;

// MARK: Row facts

// Input fields that name what a call acts on, most telling first; add a key here to cover a new tool.
const SUBJECT_KEYS = [
  "command",
  "file_path",
  "notebook_path",
  "pattern",
  "url",
  "query",
  "skill",
  "description",
  "path",
  "action",
  "prompt",
];

// Setup the reader skips to find the command that does the work: `T=/long/path;` and `cd dir &&`.
// A word stops at a shell operator, so `cd site;pwd` drops `cd site;` alone.
const SHELL_SETUP =
  /^(?:(?:[A-Za-z_]\w*=[^\s;&|<>]*|cd\s+[^\s;&|<>]+|set\s+[-+]\w+)\s*(?:;|&&)\s*)+/;
// What a path segment holds: anything but a separator, a quote or a shell operator.
const SEGMENT = String.raw`[^/\s'"\x60;&|<>()]+`;
// A path past three segments keeps its last two: the folder and the file are what tell it apart.
const LONG_PATH = new RegExp(
  String.raw`(?<![\w:/.~])(?:~|\.{0,2})?(?:/${SEGMENT}){3,}`,
  "g",
);
// A URL keeps every character: its path is the server's, not a file here.
const URL_TOKEN = /[A-Za-z][\w+.-]*:\/\/[^\s'"\x60<>]+/g;

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Paths in `text` with the current home as `~` and long ones cut to their last two segments. */
export function shortenPaths(text: string, home: string | undefined): string {
  const pieces = text.split(URL_TOKEN);
  const urls = text.match(URL_TOKEN) ?? [];
  // The home folder alone, at a path boundary: `/home/alice2` is not `/home/alice`.
  const homePath =
    home === undefined || home === "" || home === "/"
      ? undefined
      : new RegExp(
          String.raw`(?<![\w:/.~-])${escapeRegExp(home.replace(/\/+$/, ""))}(?=/|$|[\s'"\x60;&|<>()])`,
          "g",
        );
  return pieces
    .map((piece, index) => {
      const shortened = (
        homePath === undefined ? piece : piece.replace(homePath, "~")
      ).replace(
        LONG_PATH,
        (path) => "…/" + path.split("/").slice(-2).join("/"),
      );
      return shortened + (urls[index] ?? "");
    })
    .join("");
}

/** A shell command from the command that does the work, its paths shortened. */
export function shortenCommand(
  command: string,
  home: string | undefined,
): string {
  const work = command.replace(SHELL_SETUP, "");
  return shortenPaths(work === "" ? command : work, home);
}

// How each subject field reads on the line: a command and a path shorten; a URL, a pattern, a
// query or a prompt is the person's own text and stays as written.
const SHORTEN_BY_KEY: Record<string, typeof shortenPaths> = {
  command: shortenCommand,
  file_path: shortenPaths,
  notebook_path: shortenPaths,
  path: shortenPaths,
};

// This extracts the main argument of a tool call. Tools with no known key fall back to their raw
// JSON so the line is never blank, and whitespace is collapsed so a multi-line command can't break
// the line apart.
function subjectOf(input: unknown, home: string | undefined): string {
  const fields = fieldsOf(input);
  if (fields === undefined) return "";
  const key = SUBJECT_KEYS.find(
    (name) => typeof fields[name] === "string" && fields[name] !== "",
  );
  const raw =
    key !== undefined
      ? String(fields[key])
      : Object.keys(fields).length > 0
        ? JSON.stringify(fields)
        : "";
  const subject = raw.replace(/\s+/g, " ").trim();
  const shorten = key === undefined ? undefined : SHORTEN_BY_KEY[key];
  return shorten === undefined ? subject : shorten(subject, home);
}

// Each probe surfaces one fact the hidden result block would have shown; add one here to extend the meta.
// An errored call's output is the plain text the model read, so only an object carries result fields.
type MetaProbe = (
  row: ToolFacts,
  result: Record<string, unknown> | undefined,
) => string | undefined;

const SHELL_RESET = /(?:^|\n)Shell cwd was reset to [^\n]+\n?$/;

const META_PROBES: MetaProbe[] = [
  (row) => {
    const status = statusOf(row);
    return status === "interrupted" || status === "error" ? status : undefined;
  },
  (row, result) =>
    result?.backgroundTaskId !== undefined ? "background" : undefined,
  (row, result) =>
    result?.timedOutAfterMs !== undefined ? "timed out" : undefined,
  // The engine's own line, last on stderr: a file that quotes it is not a reset.
  (row, result) =>
    typeof result?.stderr === "string" && SHELL_RESET.test(result.stderr)
      ? "shell cwd was reset"
      : undefined,
  (row, result) => {
    const note = result?.returnCodeInterpretation;
    return typeof note === "string" && note !== "" ? note : undefined;
  },
];

// MARK: Line

type ToolLine = { subject: string; meta: string };

// MARK: Cells

// What the terminal draws as one character, so a cut never splits an emoji or an accent.
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// East Asian wide and fullwidth characters, and emoji, take two terminal cells.
const WIDE =
  /^(?:\p{Extended_Pictographic}|[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}])/u;

const cellsOf = (grapheme: string): number => (WIDE.test(grapheme) ? 2 : 1);

/** The terminal cells `text` takes. */
export function cellWidth(text: string): number {
  let cells = 0;
  for (const { segment } of graphemes.segment(text)) cells += cellsOf(segment);
  return cells;
}

/** `text` cut to `room` cells, an ellipsis marking the cut. */
function clip(text: string, room: number): string {
  if (cellWidth(text) <= room) return text;
  if (room <= 1) return "…";
  let kept = "";
  let cells = 0;
  for (const { segment } of graphemes.segment(text)) {
    const width = cellsOf(segment);
    if (cells + width > room - 1) break;
    kept += segment;
    cells += width;
  }
  return kept + "…";
}

// The subject is the only part cut, so the tool name and meta always stay readable.
function lineFor(
  row: ToolFacts,
  columns: number,
  home: string | undefined,
): ToolLine {
  // 2 is the dot's column, which the summary text sits beside.
  const width = Math.max(columns - GUTTER - 2, 20);
  const label = labelOf(row.tool);
  // The subject wraps in its own column, to the right of the label.
  const column = Math.max(width - cellWidth(label), 20);
  const result = fieldsOf(row.output);
  const meta = META_PROBES.map((probe) => probe(row, result))
    .filter((note) => note !== undefined)
    .join(", ");
  const budget = Math.min(
    Math.max(width, MIN_CHARS) - cellWidth(label),
    column * MAX_ROWS,
  );
  const frame = "()".length + (meta === "" ? 0 : cellWidth(` - ${meta}`));
  return { subject: clip(subjectOf(row.input, home), budget - frame), meta };
}

const labelOf = (tool: string) => `tool_call: ${tool}`;

// A hover scope is 1 to 64 characters and a call id has no bound, so a long id is cut to its
// tail and a hash of the whole, which keeps two calls apart.
const SCOPE_LIMIT = 64;

function hoverScope(id: string): string {
  const scope = `open-${id}`;
  if (scope.length <= SCOPE_LIMIT) return scope;
  let hash = 0x811c9dc5;
  for (const char of id) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  return `open-${id.slice(-40)}-${hash.toString(16)}`;
}

// MARK: Status

// The dot alone carries the call's state, so the line needs no "running" text. Theme keys follow
// the person's theme: warning is its yellow, success its green, error its red.
const DOT_COLORS: Record<Status, string> = {
  interrupted: "error",
  error: "error",
  running: "warning",
  done: "success",
};

const noteStyle = (isError: boolean) =>
  isError ? { color: "error" } : { dimColor: true };

// MARK: View

// A tool row's own flag can't tell the ctrl+o transcript (or --verbose) from a group this mod
// unfolded, but the person's prompt rows, result rows and the engine's group rows say which view
// is open. The last one heard is mirrored here so every tool site leaves that view to the engine.
// A module variable, so a hot reload forgets it until one of those rows draws again.
let isExpandedView = false;

function isCompact(surface: string): boolean {
  return surface === "terminal" && !isExpandedView;
}

// Tool rows keep their last answer until asked again, so a switch of view redraws them.
function noteView($: EngineInterface, isExpanded: boolean | undefined): void {
  if (isExpanded === undefined || isExpanded === isExpandedView) return;
  isExpandedView = isExpanded;
  $.ui.invalidate("ui.render");
}

// MARK: Home

// The current user's home folder, read once: only it is written as `~` on a line.
let home: Promise<string | undefined> | undefined;

function homeOf($: EngineInterface): Promise<string | undefined> {
  home ??= $.env.get("HOME").catch(() => undefined);
  return home;
}

// MARK: Detail pane

const PANE = "tool-detail";
const detail = atom({ plugin: "tool-lines", key: "detail" } as const, null);

// The newest facts heard for each call, from its row's drawings and its completion, so a click
// on a row the terminal has not redrawn yet, and an open pane, show where the call stands now.
// A module variable: after a hot reload the rows' next drawings fill it again.
const latest = new Map<string, Partial<ToolFacts>>();
const LATEST_LIMIT = 500;

/** Records facts for a call; true when they changed what was known. */
function remember(id: string, facts: Partial<ToolFacts>): boolean {
  const known = latest.get(id);
  const before: Record<string, unknown> = { ...known };
  const isChanged =
    known === undefined ||
    Object.entries(facts).some(([key, value]) => before[key] !== value);
  latest.delete(id);
  latest.set(id, { ...known, ...facts });
  if (latest.size > LATEST_LIMIT) {
    const oldest = latest.keys().next();
    if (oldest.done !== true) latest.delete(oldest.value);
  }
  return isChanged;
}

const newest = (call: ToolDetail): ToolDetail => ({
  ...call,
  ...latest.get(call.id),
});

// The call the pane shows, mirrored from the atom so a row's drawing can tell whether its news
// reaches the pane without subscribing every row to the selection.
let shownId: string | null = null;

// Opens and closes run one after another, so a close still settling never undoes a newer open.
let transitions: Promise<unknown> = Promise.resolve();

function serially(work: () => Promise<void>): Promise<void> {
  const run = transitions.then(work, work);
  transitions = run.catch(() => undefined);
  return run;
}

/** Whether the engine has the pane open: its record, not the module's; undefined if unknown. */
async function isPaneOpen($: EngineInterface): Promise<boolean | undefined> {
  try {
    return (await $.ui.panes()).some((pane) => pane.id === PANE);
  } catch {
    return undefined;
  }
}

// MARK: Hooks

export const register: Register = (on) => {
  on(
    "ui.render",
    { component: "UserMessage", props: { origin: { kind: "composer" } } },
    async ($, e, next) => {
      if (e.surface === "terminal") noteView($, e.props.isExpanded);
      if (!isCompact(e.surface)) return next(e);
      const { Box } = $.ui.resolve(e);
      return Box({
        flexDirection: "column",
        marginBottom: 1,
        children: [await next(e)],
      });
    },
  );

  on("ui.render", { component: "ToolUse" }, async ($, e, next) => {
    if (!isCompact(e.surface)) return next(e);
    const { Box, Text, Button } = $.ui.resolve(e);
    const line = lineFor(
      e.props,
      e.viewport?.columns ?? FALLBACK_COLUMNS,
      await homeOf($),
    );
    const row: ToolDetail = {
      id: e.props.tool_use_id,
      tool: e.props.tool,
      input: e.props.input,
      output: e.props.output,
      isRunning: e.props.isRunning,
      isErrored: e.props.isErrored,
      isInterrupted: e.props.isInterrupted,
    };

    // The dot and the label underline together under the pointer, to show they take the click.
    const hover = { scope: hoverScope(row.id), underline: true } as const;

    const { id: _id, ...facts } = row;
    // The pane shows this call: a redrawn row carries news the pane must draw too.
    if (remember(row.id, facts) && row.id === shownId) {
      $.ui.invalidate("ui.render");
    }

    // A click on the call the open pane shows closes it; any other click opens this call.
    const toggleDetail = () =>
      serially(async () => {
        const current = await read($, detail);
        if (current?.id === row.id && (await isPaneOpen($)) !== false) {
          // The ui.close hook clears the selection once the pane is gone.
          await $.ui.close({ id: PANE });
          return;
        }
        await update($, detail, () => newest(row));
        shownId = row.id;
        try {
          await $.ui.open({ id: PANE, title: `${row.tool} call` });
        } catch (error) {
          // Refused: forget the selection, so the next click opens the pane again.
          if ((await isPaneOpen($)) !== true) {
            await update($, detail, (shown) =>
              shown?.id === row.id ? null : shown,
            );
            shownId = null;
          }
          throw error;
        }
      });

    return Box({
      flexDirection: "row",
      marginLeft: 2,
      children: [
        // The dot's own column keeps wrapped rows aligned under the text, as the engine's tool rows do.
        Box({
          minWidth: 2,
          flexShrink: 0,
          children: [
            Button({
              key: "detail-dot",
              plain: true,
              hover,
              onPress: toggleDetail,
              children: [
                Text({ color: DOT_COLORS[statusOf(e.props)], children: ["●"] }),
              ],
            }),
          ],
        }),
        // Only the dot and the label open the pane, so a misclick on the subject does nothing.
        Box({
          flexShrink: 0,
          children: [
            Button({
              key: "detail",
              plain: true,
              hover,
              onPress: toggleDetail,
              children: [
                Text({ dimColor: true, children: ["tool_call: "] }),
                Text({ bold: true, children: [row.tool] }),
              ],
            }),
          ],
        }),
        Box({
          flexShrink: 1,
          children: [
            Text({
              wrap: "wrap",
              children: [
                `(${line.subject})`,
                ...(line.meta === ""
                  ? []
                  : [
                      Text({
                        ...noteStyle(row.isErrored),
                        children: [` - ${line.meta}`],
                      }),
                    ]),
              ],
            }),
          ],
        }),
      ],
    });
  });

  // Unfolding hands each grouped read or search to the ToolUse hook, so it flows like every other call.
  on("ui.render", { component: "ToolGroup" }, async ($, e, next) => {
    // The engine's own flag, before this hook unfolds the group: true only in an expanded view.
    if (e.surface === "terminal") noteView($, e.props.isExpanded);
    if (!isCompact(e.surface)) return next(e);
    return next({ ...e, props: { ...e.props, isExpanded: true } });
  });

  // The compact line already carries what the result block would say.
  on("ui.render", { component: "ToolResult" }, async ($, e, next) => {
    if (e.surface === "terminal") noteView($, e.props.isExpanded);
    if (!isCompact(e.surface)) return next(e);
    const { Box } = $.ui.resolve(e);
    return Box({});
  });

  // Every call's result is kept as it lands, so a click on a row drawn before it shows it, and
  // a call opened while it ran gets it in the pane.
  on("tool.call", async ($, e, next) => {
    const ran = await next(e);
    const isErrored = ran.deny !== undefined || ran.isError === true;
    // An abort reaches the call's chain as its signal: the row will read interrupted.
    const facts = {
      isRunning: false,
      isErrored,
      isInterrupted: isErrored && next.signal.aborted,
      output: ran.deny ?? (ran.isError ? ran.text : ran.result),
    };
    remember(e.tool_use_id, facts);
    await update($, detail, (current) =>
      current?.id === e.tool_use_id ? { ...current, ...facts } : current,
    );
    return ran;
  }).catch(($, e, next) => next(e)); // The pane is a view: a failure here never touches the call.

  // Closed by a click, its close mark or Esc, the next click on the same line opens it again. A
  // refused close keeps the pane, and with it the call it shows.
  on("ui.close", { id: PANE }, async ($, e, next) => {
    const closing = await read($, detail);
    const closed = await next(e);
    if (closed.deny === undefined) {
      await update($, detail, (current) =>
        current?.id === closing?.id ? null : current,
      );
      if (shownId === closing?.id) shownId = null;
    }
    return closed;
  }).catch(($, e, next) => next(e)); // A failed clear never keeps the pane open.

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text, Code } = $.ui.resolve(e);
    const selected = await read($, detail);
    shownId = selected?.id ?? null;
    const shown = selected === null ? null : newest(selected);
    if (shown === null)
      return Text({
        dimColor: true,
        children: ["Click a tool line's name to see its call here."],
      });
    const status = statusOf(shown);
    const sections = [...inputSections(shown), ...outputSections(shown)];

    return Box({
      flexDirection: "column",
      children: [
        Text({
          children: [
            Text({ bold: true, children: [shown.tool] }),
            Text({
              ...noteStyle(status === "error"),
              children: [` · ${status}`],
            }),
          ],
        }),
        ...sections.flatMap((section) => [
          Box({
            marginTop: 1,
            children: [Text({ dimColor: true, children: [section.label] })],
          }),
          Code(section.code),
        ]),
      ],
    });
  });
};
