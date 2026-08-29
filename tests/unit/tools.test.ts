import assert from "node:assert/strict";
import test from "node:test";
import { JarvisError } from "../../src/errors.js";
import type { StructuredCommand } from "../../src/intents/contracts.js";
import { PermissionEngine } from "../../src/intents/permissions.js";
import {
  GetBatteryTool,
  OpenApplicationTool,
  SafeActionExecutor,
  ToolRegistry,
  macOSInvocationFor,
  type SafeMacOSOperation,
  type SafeMacOSOperationResult,
  type SafeMacOSOperationRunner
} from "../../src/tools/index.js";

class FakeRunner implements SafeMacOSOperationRunner {
  readonly operations: SafeMacOSOperation[] = [];
  readonly #results: SafeMacOSOperationResult[];
  readonly #failure: Error | undefined;

  constructor(results: SafeMacOSOperationResult[], failure?: Error) {
    this.#results = [...results];
    this.#failure = failure;
  }

  async run(operation: SafeMacOSOperation): Promise<SafeMacOSOperationResult> {
    this.operations.push(operation);
    if (this.#failure !== undefined) {
      throw this.#failure;
    }
    const result = this.#results.shift();
    if (result === undefined) {
      throw new Error("Missing fake result.");
    }
    return result;
  }
}

const openSafari: StructuredCommand = {
  intent: "OPEN_APPLICATION",
  parameters: { application: "Safari" },
  confidence: 1
};
const getBattery: StructuredCommand = { intent: "GET_BATTERY", parameters: {}, confidence: 1 };

test("maps the closed operation union to fixed executable and argv without a shell", () => {
  assert.deepEqual(macOSInvocationFor({ kind: "OPEN_APPLICATION", application: "Safari" }), {
    executable: "/usr/bin/open",
    arguments: ["-a", "Safari"]
  });
  assert.deepEqual(macOSInvocationFor({ kind: "VERIFY_APPLICATION", application: "Finder" }), {
    executable: "/usr/bin/pgrep",
    arguments: ["-x", "Finder"]
  });
  assert.deepEqual(macOSInvocationFor({ kind: "GET_BATTERY" }), {
    executable: "/usr/bin/pmset",
    arguments: ["-g", "batt"]
  });
  for (const operation of [
    { kind: "OPEN_APPLICATION", application: "Terminal" },
    { kind: "VERIFY_APPLICATION", application: "Calculator" },
    { kind: "SHELL", command: "rm -rf /" },
    null
  ]) {
    assert.throws(
      () => macOSInvocationFor(operation as never),
      (error: unknown) => error instanceof JarvisError && error.code === "ACTION_NOT_ALLOWED"
    );
  }
});

test("opens only an allowlisted application and verifies the process", async () => {
  const runner = new FakeRunner([
    { exitCode: 0, stdout: "" },
    { exitCode: 0, stdout: "123\n" }
  ]);
  const result = await new OpenApplicationTool(runner).execute(openSafari);
  assert.deepEqual(runner.operations, [
    { kind: "OPEN_APPLICATION", application: "Safari" },
    { kind: "VERIFY_APPLICATION", application: "Safari" }
  ]);
  assert.deepEqual(result, {
    status: "SUCCESS",
    intent: "OPEN_APPLICATION",
    verified: true,
    data: { application: "Safari", running: true }
  });
});

test("reports failed application launch or verification without claiming success", async () => {
  const launchFailure = await new OpenApplicationTool(
    new FakeRunner([{ exitCode: 1, stdout: "sensitive backend detail" }])
  ).execute(openSafari);
  assert.deepEqual(launchFailure, {
    status: "FAILED",
    intent: "OPEN_APPLICATION",
    verified: false,
    data: null
  });
  const verifyFailure = await new OpenApplicationTool(
    new FakeRunner([
      { exitCode: 0, stdout: "" },
      { exitCode: 1, stdout: "" }
    ])
  ).execute(openSafari);
  assert.equal(verifyFailure.status, "FAILED");
  assert.equal(verifyFailure.verified, false);
  const malformedVerification = await new OpenApplicationTool(
    new FakeRunner([
      { exitCode: 0, stdout: "" },
      { exitCode: 0, stdout: "not-a-pid" }
    ])
  ).execute(openSafari);
  assert.equal(malformedVerification.status, "FAILED");
});

test("returns a verified and strictly parsed battery result", async () => {
  const runner = new FakeRunner([
    {
      exitCode: 0,
      stdout: "Now drawing from 'AC Power'\n -InternalBattery-0\t26%; discharging"
    }
  ]);
  assert.deepEqual(await new GetBatteryTool(runner).execute(getBattery), {
    status: "SUCCESS",
    intent: "GET_BATTERY",
    verified: true,
    data: { percentage: 26, powerSource: "AC" }
  });
  assert.deepEqual(runner.operations, [{ kind: "GET_BATTERY" }]);
});

test("rejects malformed battery output and sanitizes runner failures", async () => {
  for (const stdout of [
    "Battery unknown",
    "Now drawing from 'UPS Power'\n50%",
    "Battery Power 101%"
  ]) {
    await assert.rejects(
      new GetBatteryTool(new FakeRunner([{ exitCode: 0, stdout }])).execute(getBattery),
      (error: unknown) => error instanceof JarvisError && error.code === "TOOL_VERIFICATION_FAILED"
    );
  }
  await assert.rejects(
    new GetBatteryTool(
      new FakeRunner([], new Error("/private/path token=secret"))
    ).execute(getBattery),
    (error: unknown) =>
      error instanceof JarvisError &&
      error.code === "TOOL_EXECUTION_FAILED" &&
      !error.message.includes("private")
  );
});

test("registry rejects duplicates, missing tools, and forged commands", async () => {
  const registry = new ToolRegistry();
  const tool = new GetBatteryTool(
    new FakeRunner([{ exitCode: 0, stdout: "Battery Power 50%" }])
  );
  registry.register(tool);
  assert.throws(
    () => registry.register(tool),
    (error: unknown) => error instanceof JarvisError && error.code === "ACTION_NOT_ALLOWED"
  );
  assert.throws(
    () => registry.register({ intent: "SHELL" } as never),
    (error: unknown) => error instanceof JarvisError && error.code === "ACTION_NOT_ALLOWED"
  );
  assert.throws(
    () => new ToolRegistry().execute(getBattery),
    (error: unknown) => error instanceof JarvisError && error.code === "TOOL_NOT_FOUND"
  );
  assert.throws(
    () => registry.execute({ intent: "SHELL" } as unknown as StructuredCommand),
    (error: unknown) => error instanceof JarvisError && error.code === "ACTION_NOT_ALLOWED"
  );
});

test("safe executor applies permission classification before registry execution", async () => {
  const registry = new ToolRegistry();
  registry.register(
    new GetBatteryTool(
      new FakeRunner([{ exitCode: 0, stdout: "Now drawing from 'Battery Power'\n73%" }])
    )
  );
  const result = await new SafeActionExecutor(new PermissionEngine(), registry).execute(getBattery);
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.verified, true);
});
