import type { BuiltinToolResults, CodeProps } from "claude-code";

import type { ToolFacts } from "../types";

// MARK: Sections

/** One labelled block of the detail pane, drawn as a `Code`. */
export type Section = { label: string; code: CodeProps };

type Hunk = BuiltinToolResults["Edit"]["structuredPatch"][number];

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const fieldsOf = (value: unknown): Fields | undefined =>
  isFields(value) ? value : undefined;

const json = (value: unknown): string =>
  JSON.stringify(value, null, 2) ?? String(value);

export type Status = "interrupted" | "error" | "running" | "done";

export function statusOf(call: ToolFacts): Status {
  if (call.isInterrupted) return "interrupted";
  if (call.isErrored) return "error";
  // isRunning is false while a call waits its turn or its approval, so only a stored result marks it done.
  if (call.isRunning || call.output === undefined) return "running";

  return "done";
}

// MARK: Input

/** A Bash command reads best as shell; every other input as its JSON. */
export function inputSections(call: ToolFacts): Section[] {
  const fields = fieldsOf(call.input);
  if (call.tool === "Bash" && typeof fields?.command === "string") {
    const { command, ...rest } = fields;
    const sections: Section[] = [
      { label: "Command", code: { source: command, language: "bash" } },
    ];

    return printable(
      Object.keys(rest).length === 0
        ? sections
        : [
            ...sections,
            {
              label: "Options",
              code: { source: json(rest), language: "json" },
            },
          ],
    );
  }

  return [
    {
      label: "Input",
      code: { source: json(call.input ?? {}), language: "json" },
    },
  ];
}

// MARK: Output

function diffOf(hunks: Hunk[]): string {
  return hunks
    .map((hunk) =>
      [
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
        ...hunk.lines,
      ].join("\n"),
    )
    .join("\n");
}

const isHunkList = (value: unknown): value is Hunk[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((hunk) => Array.isArray(fieldsOf(hunk)?.lines));

/** Reads one tool's result; undefined when the shape is not the one it knows, for the JSON. */
type OutputRenderer = (output: Fields) => Section[] | undefined;

const text = (source: string): CodeProps => ({ source });

// Bash's fields that point past the streams: where the command went on, or where its output went.
const BASH_DETAILS: [key: string, label: string][] = [
  ["backgroundTaskId", "Background task"],
  ["backgroundOutputPath", "Background output"],
  ["persistedOutputPath", "Saved output"],
  ["rawOutputPath", "Raw output"],
];

// Bash: its two streams, each only when it printed something, then the task or file the rest
// of its output went to. A stream of another shape is not Bash's, so the result falls through.
const bashOutput: OutputRenderer = (output) => {
  const { stdout, stderr } = output;
  if (stdout === undefined && stderr === undefined) return undefined;
  if (stdout !== undefined && typeof stdout !== "string") return undefined;
  if (stderr !== undefined && typeof stderr !== "string") return undefined;
  const sections: Section[] = [];
  if (stdout) sections.push({ label: "stdout", code: text(stdout) });
  if (stderr) sections.push({ label: "stderr", code: text(stderr) });
  const details = BASH_DETAILS.flatMap(([key, label]) => {
    const value = output[key];
    return typeof value === "string" && value !== ""
      ? [`${label}: ${value}`]
      : [];
  });
  if (details.length > 0)
    sections.push({ label: "Details", code: text(details.join("\n")) });

  return sections.length > 0
    ? sections
    : [{ label: "Output", code: text("(no output)") }];
};

// Edit and Write: the change as a diff, else the file's whole content. A staged write was held
// for the machine owner's review, so it reads as proposed: the file is unchanged.
const fileChange: OutputRenderer = (output) => {
  const isStaged = output.staged === true;
  const path = typeof output.filePath === "string" ? output.filePath : "";
  const sections: Section[] = isStaged
    ? [
        {
          label: "Staged",
          code: text("Held for the owner's review: the file is unchanged."),
        },
      ]
    : [];
  if (isHunkList(output.structuredPatch)) {
    return [
      ...sections,
      {
        label: isStaged ? "Proposed diff" : "Diff",
        code: { source: diffOf(output.structuredPatch), format: "diff" },
      },
    ];
  }
  if (typeof output.content === "string") {
    const label = isStaged
      ? "Proposed content"
      : output.type === "create"
        ? "Created"
        : "Content";
    return [...sections, { label, code: { source: output.content, path } }];
  }

  return undefined;
};

// Read: the file's lines, numbered from where the read started.
const fileRead: OutputRenderer = (output) => {
  const file = fieldsOf(output.file);
  if (typeof file?.content !== "string") return undefined;
  const startLine = typeof file.startLine === "number" ? file.startLine : 1;

  return [
    {
      label: "File",
      code:
        typeof file.filePath === "string"
          ? { source: file.content, path: file.filePath, startLine }
          : { source: file.content, startLine },
    },
  ];
};

// Grep and Glob: matched lines, or the file list.
const search: OutputRenderer = (output) => {
  if (typeof output.content === "string")
    return [{ label: "Matches", code: text(output.content) }];
  if (Array.isArray(output.filenames))
    return [
      {
        label: "Files",
        code: text(output.filenames.join("\n") || "(none)"),
      },
    ];

  return undefined;
};

/** The built-in tools whose result shape the pane knows; any other tool shows its JSON. */
// A Map, so a tool named like an Object member (`toString`) finds no renderer.
const OUTPUT_RENDERERS = new Map<string, OutputRenderer>([
  ["Bash", bashOutput],
  ["Edit", fileChange],
  ["MultiEdit", fileChange],
  ["Write", fileChange],
  ["Read", fileRead],
  ["Grep", search],
  ["Glob", search],
]);

export function outputSections(call: ToolFacts): Section[] {
  const { output } = call;
  if (output === undefined) return [];
  // An errored, refused or interrupted call carries the text the model read.
  if (typeof output === "string")
    return printable([
      { label: call.isErrored ? "Error" : "Output", code: text(output) },
    ]);
  const fields = fieldsOf(output);
  const sections =
    fields === undefined
      ? undefined
      : OUTPUT_RENDERERS.get(call.tool)?.(fields);

  return printable(
    sections ?? [
      { label: "Output", code: { source: json(output), language: "json" } },
    ],
  );
}

// MARK: Printable

// A Code element takes tab and newline as its only control characters, and a pane holding any
// other is refused whole. Terminal output brings colors and progress lines, so each source is
// read as a terminal would show it: escapes dropped, a carriage return's line overwritten, and
// any other control drawn as its visible picture.
// A CSI sequence (colors, cursor moves), an OSC one (titles, links), or any other escape.
const ESCAPES =
  // oxlint-disable-next-line no-control-regex -- matching control characters is the point
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[ -/]*[0-~])/g;
// oxlint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

// A carriage return moves the cursor back to the line's start: later text overwrites what it
// reaches, and what it does not reach stays, as on the terminal.
function overwrite(line: string): string {
  if (!line.includes("\r")) return line;
  const cells: string[] = [];
  let cursor = 0;
  for (const part of line.split("\r")) {
    for (const char of part) {
      cells[cursor] = char;
      cursor += 1;
    }
    cursor = 0;
  }
  return cells.join("");
}

export function printableSource(source: string): string {
  return source
    .replace(/\r\n/g, "\n")
    .replace(ESCAPES, "")
    .split("\n")
    .map(overwrite)
    .join("\n")
    .replace(CONTROLS, (control) => {
      const code = control.charCodeAt(0);
      if (code < 0x20) return String.fromCharCode(0x2400 + code);
      if (code === 0x7f) return "\u2421";
      return `\\x${code.toString(16)}`;
    });
}

const printable = (sections: Section[]): Section[] =>
  sections.map((section) => ({
    ...section,
    code: { ...section.code, source: printableSource(section.code.source) },
  }));
