// Named .spec.ts, not .test.ts: `claude plugin test .` loads every
// *.test.ts in the mod as a mod test, and this file runs under `bun test`.
import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

// `claude plugin validate` type-checks the module against every declaration
// in the manifest's types folder, so a stand-in for Claude Code's API there
// collides with the real one (TS2769 on each `read` and `update`). The
// folder holds the mod's state contract alone; the shim lives in shim/.
test("the types folder holds the state contract alone", async () => {
  expect(await readdir(join(ROOT, "types"))).toEqual(["index.d.ts"]);
});
