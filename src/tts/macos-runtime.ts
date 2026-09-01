import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { JarvisError } from "../errors.js";
import type { TTSBackendMetadata } from "./contracts.js";
import type { TTSRuntimeClient, TTSRuntimeInput, TTSRuntimeResult } from "./runtime.js";

export interface MacOSSpeechProcessInput {
  readonly text: string;
  readonly voice: string;
  readonly rateWordsPerMinute: number;
}

export interface MacOSSpeechProcessRunner {
  run(
    input: MacOSSpeechProcessInput,
    signal?: AbortSignal
  ): Promise<{ readonly exitCode: number; readonly processStartupLatencyMs?: number }>;
}

export class SystemSayProcessRunner implements MacOSSpeechProcessRunner {
  run(
    input: MacOSSpeechProcessInput,
    signal?: AbortSignal
  ): Promise<{ readonly exitCode: number; readonly processStartupLatencyMs?: number }> {
    const invocation = macOSSpeechInvocationFor(input);
    if (signal?.aborted === true) {
      return Promise.reject(new DOMException("Speech playback aborted.", "AbortError"));
    }
    return new Promise((resolve, reject) => {
      const startedAt = performance.now();
      const child = spawn(invocation.executable, invocation.arguments, {
        stdio: "ignore",
        shell: false
      });
      let processStartupLatencyMs: number | undefined;
      let settled = false;
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        cleanup();
        reject(new DOMException("Speech playback aborted.", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted === true) {
        onAbort();
        return;
      }
      child.once("spawn", () => {
        processStartupLatencyMs = finiteElapsed(startedAt);
      });
      child.once("error", () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("System speech process failed."));
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          exitCode: code ?? 1,
          ...(processStartupLatencyMs === undefined ? {} : { processStartupLatencyMs })
        });
      });
    });
  }
}

export class MacOSSystemSpeechRuntime implements TTSRuntimeClient {
  readonly metadata: TTSBackendMetadata;
  readonly #runner: MacOSSpeechProcessRunner;

  constructor(voice: string, rateWordsPerMinute: number, runner = new SystemSayProcessRunner()) {
    macOSSpeechInvocationFor({ text: "configuration-check", voice, rateWordsPerMinute });
    this.metadata = { backend: "macos-say", voice, rateWordsPerMinute };
    this.#runner = runner;
  }

  async speak(input: TTSRuntimeInput, signal?: AbortSignal): Promise<TTSRuntimeResult> {
    try {
      const result = await this.#runner.run(
        {
          text: input.text,
          voice: this.metadata.voice,
          rateWordsPerMinute: this.metadata.rateWordsPerMinute
        },
        signal
      );
      return result.exitCode === 0
        ? {
            status: "COMPLETED",
            ...(result.processStartupLatencyMs === undefined
              ? {}
              : { processStartupLatencyMs: result.processStartupLatencyMs })
          }
        : { status: "INVALID", errorCode: "PLAYBACK_FAILED" };
    } catch (error) {
      if (signal?.aborted === true) throw error;
      return { status: "INVALID", errorCode: "PLAYBACK_FAILED" };
    }
  }
}

function finiteElapsed(startedAt: number): number {
  const elapsed = performance.now() - startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}

export function macOSSpeechInvocationFor(input: MacOSSpeechProcessInput): {
  readonly executable: "/usr/bin/say";
  readonly arguments: readonly string[];
} {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.text !== "string" ||
    input.text.length === 0 ||
    input.text.length > 1_000 ||
    input.text.trim() !== input.text ||
    /[\uD800-\uDFFF]/u.test(input.text) ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u.test(
      input.text
    ) ||
    !/^[\p{L}\p{N} ._-]{1,64}$/u.test(input.voice) ||
    !Number.isSafeInteger(input.rateWordsPerMinute) ||
    input.rateWordsPerMinute < 80 ||
    input.rateWordsPerMinute > 500
  ) {
    throw new JarvisError("TTS_INVALID_TEXT", 422, "System speech invocation is invalid.");
  }
  return {
    executable: "/usr/bin/say",
    arguments: ["-v", input.voice, "-r", String(input.rateWordsPerMinute), input.text]
  };
}
