import { spawn, type ChildProcess } from "node:child_process";
import { access, lstat } from "node:fs/promises";
import { JarvisError } from "../errors.js";

const ALLOWED_EXECUTABLES = new Set([
  "/opt/homebrew/bin/whisper-server",
  "/usr/local/bin/whisper-server"
]);

export interface WhisperServerProcessOptions {
  readonly executable: string;
  readonly modelPath: string;
  readonly endpoint: string;
  readonly startupTimeoutMilliseconds?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly spawnProcess?: typeof spawn;
}

export class WhisperServerProcess {
  readonly #options: WhisperServerProcessOptions;
  readonly #fetch: typeof globalThis.fetch;
  readonly #spawn: typeof spawn;
  #process: ChildProcess | undefined;

  constructor(options: WhisperServerProcessOptions) {
    if (!ALLOWED_EXECUTABLES.has(options.executable) || !isSafeModelPath(options.modelPath)) {
      throw unavailable();
    }
    validateEndpoint(options.endpoint);
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#spawn = options.spawnProcess ?? spawn;
  }

  async start(signal?: AbortSignal): Promise<void> {
    if (this.#process !== undefined) return;
    try {
      await access(this.#options.executable);
      const model = await lstat(this.#options.modelPath);
      if (!model.isFile() || model.isSymbolicLink() || model.size < 1_000_000) throw unavailable();
    } catch (error) {
      if (error instanceof JarvisError) throw error;
      throw unavailable();
    }
    const endpoint = new URL(this.#options.endpoint);
    const process = this.#spawn(this.#options.executable, [
      "--host", "127.0.0.1",
      "--port", endpoint.port || "80",
      "--model", this.#options.modelPath,
      "--language", "auto",
      "--threads", "4"
    ], { shell: false, stdio: ["ignore", "ignore", "ignore"] });
    this.#process = process;
    const failed = new Promise<never>((_resolve, reject) => {
      process.once("error", () => reject(unavailable()));
      process.once("exit", () => reject(unavailable()));
    });
    const abort = (): void => {
      process.kill("SIGTERM");
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await Promise.race([this.#waitUntilReady(process, signal), failed]);
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  async close(): Promise<void> {
    const process = this.#process;
    this.#process = undefined;
    if (process === undefined || process.exitCode !== null || process.signalCode !== null) return;
    process.kill("SIGTERM");
    if (!await waitForExit(process, 1_000)) {
      process.kill("SIGKILL");
      await waitForExit(process, 1_000);
    }
  }

  async #waitUntilReady(process: ChildProcess, signal?: AbortSignal): Promise<void> {
    const endpoint = new URL(this.#options.endpoint);
    const health = new URL("/health", endpoint.origin);
    const deadline = Date.now() + (this.#options.startupTimeoutMilliseconds ?? 90_000);
    while (Date.now() < deadline) {
      if (signal?.aborted === true) throw signal.reason;
      if (process.exitCode !== null || process.signalCode !== null) throw unavailable();
      try {
        const response = await this.#fetch(health, signal === undefined ? {} : { signal });
        if (response.ok) return;
      } catch {
        if (isAborted(signal)) throw signal?.reason;
      }
      await delay(100, signal);
    }
    throw unavailable();
  }
}

export function createConfiguredWhisperServer(
  environment: NodeJS.ProcessEnv = process.env
): WhisperServerProcess {
  const home = environment.HOME;
  if (home === undefined || !home.startsWith("/")) throw unavailable();
  return new WhisperServerProcess({
    executable: environment.JARVIS_WHISPER_SERVER ?? "/opt/homebrew/bin/whisper-server",
    modelPath: environment.JARVIS_WHISPER_MODEL_PATH ?? `${home}/.jarvis/models/whisper/ggml-base.bin`,
    endpoint: environment.JARVIS_STT_ENDPOINT ?? "http://127.0.0.1:8080/inference"
  });
}

function validateEndpoint(value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/inference" ||
        url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") throw unavailable();
  } catch (error) {
    if (error instanceof JarvisError) throw error;
    throw unavailable();
  }
}

function isSafeModelPath(value: string): boolean {
  return value.startsWith("/") && value.endsWith(".bin") && !value.includes("\0") && !value.includes("\n");
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const complete = (): void => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timeout = setTimeout(complete, milliseconds);
    const abort = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function waitForExit(process: ChildProcess, timeoutMilliseconds: number): Promise<boolean> {
  if (process.exitCode !== null || process.signalCode !== null) return true;
  return await Promise.race([
    new Promise<true>((resolve) => process.once("exit", () => resolve(true))),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMilliseconds))
  ]);
}

function unavailable(): JarvisError {
  return new JarvisError("STT_MODEL_UNAVAILABLE", 503, "Local whisper.cpp runtime is unavailable.");
}
