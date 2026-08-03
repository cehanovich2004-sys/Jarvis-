import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const localBinPath = `${process.cwd()}/node_modules/.bin:${process.env.PATH ?? ""}`;

test("cli supports status command", async () => {
  const result = await execFileAsync(process.execPath, ["dist/src/cli.js", "ask", "статус"]);

  assert.match(result.stdout, /JARVIS Core работает локально/);
  assert.equal(result.stderr, "");
});

test("local jarvis bin supports status command shape", async () => {
  const result = await execFileAsync("jarvis", ["ask", "статус"], {
    env: { ...process.env, PATH: localBinPath }
  });

  assert.match(result.stdout, /JARVIS Core работает локально/);
  assert.equal(result.stderr, "");
});

test("cli supports help command", async () => {
  const result = await execFileAsync(process.execPath, ["dist/src/cli.js", "ask", "помощь"]);

  assert.match(result.stdout, /Доступные команды/);
  assert.equal(result.stderr, "");
});

test("cli rejects unknown command", async () => {
  await assert.rejects(execFileAsync(process.execPath, ["dist/src/cli.js", "ask", "открой браузер"]), (error) => {
    const typedError = error as { code?: number; stderr?: string };
    assert.equal(typedError.code, 2);
    assert.match(typedError.stderr ?? "", /COMMAND_NOT_SUPPORTED/);
    return true;
  });
});
