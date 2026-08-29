import { execFile } from "node:child_process";
import { JarvisError } from "../errors.js";
import type {
  SafeMacOSOperation,
  SafeMacOSOperationResult,
  SafeMacOSOperationRunner
} from "./contracts.js";

const MAX_OUTPUT_BYTES = 16_384;
const DEFAULT_TIMEOUT_MS = 5_000;

export class MacOSOperationRunner implements SafeMacOSOperationRunner {
  readonly #timeoutMilliseconds: number;

  constructor(timeoutMilliseconds = DEFAULT_TIMEOUT_MS) {
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
      throw executionFailure();
    }
    this.#timeoutMilliseconds = timeoutMilliseconds;
  }

  run(operation: SafeMacOSOperation, signal?: AbortSignal): Promise<SafeMacOSOperationResult> {
    const invocation = macOSInvocationFor(operation);
    return new Promise((resolve, reject) => {
      execFile(
        invocation.executable,
        invocation.arguments,
        {
          encoding: "utf8",
          maxBuffer: MAX_OUTPUT_BYTES,
          timeout: this.#timeoutMilliseconds,
          ...(signal === undefined ? {} : { signal })
        },
        (error, stdout) => {
          if (error === null) {
            resolve({ exitCode: 0, stdout });
            return;
          }
          if (typeof error.code === "number") {
            resolve({ exitCode: error.code, stdout });
            return;
          }
          reject(executionFailure());
        }
      );
    });
  }
}

export function macOSInvocationFor(operation: SafeMacOSOperation): {
  readonly executable: string;
  readonly arguments: readonly string[];
} {
  if (typeof operation !== "object" || operation === null) {
    throw notAllowed();
  }
  if (
    (operation.kind === "OPEN_APPLICATION" || operation.kind === "VERIFY_APPLICATION") &&
    operation.application !== "Safari" &&
    operation.application !== "Finder"
  ) {
    throw notAllowed();
  }
  if (operation.kind === "OPEN_APPLICATION") {
    return { executable: "/usr/bin/open", arguments: ["-a", operation.application] };
  }
  if (operation.kind === "VERIFY_APPLICATION") {
    return { executable: "/usr/bin/pgrep", arguments: ["-x", operation.application] };
  }
  if (operation.kind === "GET_BATTERY") {
    return { executable: "/usr/bin/pmset", arguments: ["-g", "batt"] };
  }
  throw notAllowed();
}

function executionFailure(): JarvisError {
  return new JarvisError("TOOL_EXECUTION_FAILED", 502, "Safe macOS operation failed.");
}

function notAllowed(): JarvisError {
  return new JarvisError("ACTION_NOT_ALLOWED", 403, "Safe macOS operation is not allowed.");
}
