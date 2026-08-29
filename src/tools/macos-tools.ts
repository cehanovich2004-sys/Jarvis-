import { JarvisError } from "../errors.js";
import type { StructuredCommand } from "../intents/contracts.js";
import type {
  RegisteredTool,
  SafeMacOSOperationRunner,
  ToolExecutionResult
} from "./contracts.js";

export class OpenApplicationTool implements RegisteredTool {
  readonly intent = "OPEN_APPLICATION" as const;
  readonly #runner: SafeMacOSOperationRunner;

  constructor(runner: SafeMacOSOperationRunner) {
    this.#runner = runner;
  }

  async execute(command: StructuredCommand, signal?: AbortSignal): Promise<ToolExecutionResult> {
    if (command.intent !== this.intent) {
      throw notAllowed();
    }
    const application = command.parameters.application;
    const opened = await safelyRun(this.#runner, { kind: "OPEN_APPLICATION", application }, signal);
    if (opened.exitCode !== 0) {
      return { status: "FAILED", intent: this.intent, verified: false, data: null };
    }
    const verified = await safelyRun(
      this.#runner,
      { kind: "VERIFY_APPLICATION", application },
      signal
    );
    const processIdentifiers = verified.stdout.trim().split(/\s+/u).filter(Boolean);
    if (
      verified.exitCode !== 0 ||
      processIdentifiers.length === 0 ||
      !processIdentifiers.every((value) => /^\d+$/u.test(value))
    ) {
      return { status: "FAILED", intent: this.intent, verified: false, data: null };
    }
    return {
      status: "SUCCESS",
      intent: this.intent,
      verified: true,
      data: { application, running: true }
    };
  }
}

export class GetBatteryTool implements RegisteredTool {
  readonly intent = "GET_BATTERY" as const;
  readonly #runner: SafeMacOSOperationRunner;

  constructor(runner: SafeMacOSOperationRunner) {
    this.#runner = runner;
  }

  async execute(command: StructuredCommand, signal?: AbortSignal): Promise<ToolExecutionResult> {
    if (command.intent !== this.intent) {
      throw notAllowed();
    }
    const result = await safelyRun(this.#runner, { kind: "GET_BATTERY" }, signal);
    if (result.exitCode !== 0) {
      return { status: "FAILED", intent: this.intent, verified: false, data: null };
    }
    const percentageMatch = /\b(\d{1,3})%/.exec(result.stdout);
    const percentage = Number(percentageMatch?.[1]);
    const sourceMatch = /^Now drawing from '(AC|Battery) Power'$/mu.exec(result.stdout);
    const powerSource =
      sourceMatch?.[1] === "AC" ? "AC" : sourceMatch?.[1] === "Battery" ? "BATTERY" : undefined;
    if (
      !Number.isInteger(percentage) ||
      percentage < 0 ||
      percentage > 100 ||
      powerSource === undefined
    ) {
      throw new JarvisError("TOOL_VERIFICATION_FAILED", 502, "Battery result is invalid.");
    }
    return {
      status: "SUCCESS",
      intent: this.intent,
      verified: true,
      data: { percentage, powerSource }
    };
  }
}

async function safelyRun(
  runner: SafeMacOSOperationRunner,
  operation: Parameters<SafeMacOSOperationRunner["run"]>[0],
  signal?: AbortSignal
) {
  try {
    return await runner.run(operation, signal);
  } catch {
    throw new JarvisError("TOOL_EXECUTION_FAILED", 502, "Safe macOS operation failed.");
  }
}

function notAllowed(): JarvisError {
  return new JarvisError("ACTION_NOT_ALLOWED", 403, "Action is not allowed.");
}
