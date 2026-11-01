// What `claude-code/testing` resolves to under `bun test`: each mod test is
// listed as skipped, since only `claude plugin test .` can run it (the
// mod-tests job in CI does).
import { describe as bunDescribe, test as bunTest } from "bun:test";

export { expect } from "bun:test";

export const test = (name: string) => {
  bunTest.skip(`${name} (runs under claude plugin test .)`, () => {});
};

export const describe = (name: string, body: () => void) => {
  bunDescribe(name, body);
};
