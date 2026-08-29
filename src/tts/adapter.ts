import { performance } from "node:perf_hooks";
import { JarvisError } from "../errors.js";
import {
  DEFAULT_MAX_SPEECH_CHARACTERS,
  type SpeechPlaybackResult,
  type SpeechRequest,
  type TTSBackendMetadata
} from "./contracts.js";
import type { TTSRuntimeClient, TTSRuntimeResult } from "./runtime.js";

export interface TextToSpeechAdapterOptions {
  readonly timeoutMilliseconds?: number;
  readonly maxSpeechCharacters?: number;
}

export class TextToSpeechAdapter {
  readonly #runtime: TTSRuntimeClient;
  readonly #metadata: TTSBackendMetadata;
  readonly #timeoutMilliseconds: number;
  readonly #maxSpeechCharacters: number;

  constructor(runtime: TTSRuntimeClient, options: TextToSpeechAdapterOptions = {}) {
    this.#runtime = runtime;
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 30_000;
    this.#maxSpeechCharacters = options.maxSpeechCharacters ?? DEFAULT_MAX_SPEECH_CHARACTERS;
    validatePositiveInteger(this.#timeoutMilliseconds);
    validatePositiveInteger(this.#maxSpeechCharacters);
    if (this.#maxSpeechCharacters > DEFAULT_MAX_SPEECH_CHARACTERS) {
      throw invalidResponse();
    }
    try {
      validateMetadata(runtime.metadata);
      this.#metadata = { ...runtime.metadata };
    } catch (error) {
      if (error instanceof JarvisError) throw error;
      throw invalidResponse();
    }
  }

  async speak(request: SpeechRequest, signal?: AbortSignal): Promise<SpeechPlaybackResult> {
    let text: string;
    try {
      text = validateSpeechRequest(request, this.#maxSpeechCharacters);
    } catch (error) {
      if (error instanceof JarvisError) throw error;
      throw invalidText();
    }
    const startedAt = performance.now();
    let runtimeResult: TTSRuntimeResult;
    try {
      runtimeResult = await runBounded(
        (operationSignal) => this.#runtime.speak({ text }, operationSignal),
        this.#timeoutMilliseconds,
        signal
      );
    } catch (error) {
      if (error instanceof OperationCancelledError) {
        throw new JarvisError("TTS_CANCELLED", 499, "Speech playback was cancelled.");
      }
      if (error instanceof OperationTimeoutError) {
        throw new JarvisError("TTS_TIMEOUT", 504, "Speech playback timed out.");
      }
      throw runtimeFailure();
    }
    try {
      if (typeof runtimeResult !== "object" || runtimeResult === null) {
        throw invalidResponse();
      }
      if (runtimeResult.status === "INVALID") {
        if (runtimeResult.errorCode === "VOICE_UNAVAILABLE") {
          throw new JarvisError("TTS_VOICE_UNAVAILABLE", 503, "Speech voice is unavailable.");
        }
        throw runtimeFailure();
      }
      if (runtimeResult.status !== "COMPLETED") {
        throw invalidResponse();
      }
      return {
        status: "COMPLETED",
        characterCount: text.length,
        playbackLatencyMs: finiteElapsed(startedAt),
        backendMetadata: { ...this.#metadata }
      };
    } catch (error) {
      if (error instanceof JarvisError) {
        throw error;
      }
      throw invalidResponse();
    }
  }
}

function validateSpeechRequest(request: SpeechRequest, maxCharacters: number): string {
  if (typeof request !== "object" || request === null || typeof request.text !== "string") {
    throw invalidText();
  }
  if (request.language !== undefined && request.language !== "RU" && request.language !== "EN") {
    throw invalidText();
  }
  if (hasInvalidUnicode(request.text) || hasControlGarbage(request.text)) {
    throw invalidText();
  }
  const text = request.text.replace(/\s+/gu, " ").trim();
  if (text.length === 0 || text.length > maxCharacters) {
    throw invalidText();
  }
  return text;
}

function validateMetadata(metadata: TTSBackendMetadata): void {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !isSafeMetadata(metadata.backend) ||
    !isSafeMetadata(metadata.voice) ||
    !Number.isSafeInteger(metadata.rateWordsPerMinute) ||
    metadata.rateWordsPerMinute < 80 ||
    metadata.rateWordsPerMinute > 500
  ) {
    throw invalidResponse();
  }
}

function isSafeMetadata(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    value.trim() === value &&
    !/[\u0000-\u001F\u007F-\u009F]/u.test(value)
  );
}

function hasInvalidUnicode(value: string): boolean {
  return /[\uD800-\uDFFF]/u.test(value);
}

function hasControlGarbage(value: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u.test(
    value
  );
}

function validatePositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw invalidResponse();
  }
}

function invalidText(): JarvisError {
  return new JarvisError("TTS_INVALID_TEXT", 422, "Speech text is invalid.");
}

function runtimeFailure(): JarvisError {
  return new JarvisError("TTS_RUNTIME_FAILURE", 502, "Speech playback failed.");
}

function invalidResponse(): JarvisError {
  return new JarvisError("TTS_INVALID_RESPONSE", 502, "TTS runtime returned an invalid response.");
}

function finiteElapsed(startedAt: number): number {
  const elapsed = performance.now() - startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}

class OperationTimeoutError extends Error {}
class OperationCancelledError extends Error {}

async function runBounded<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMilliseconds: number,
  externalSignal?: AbortSignal
): Promise<T> {
  if (externalSignal?.aborted === true) {
    throw new OperationCancelledError();
  }
  const controller = new AbortController();
  let terminalReason: "TIMEOUT" | "CANCELLED" | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeoutResult = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      if (terminalReason !== undefined) return;
      terminalReason = "TIMEOUT";
      controller.abort();
      reject(new OperationTimeoutError());
    }, timeoutMilliseconds);
  });
  const cancellationResult = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      if (terminalReason !== undefined) return;
      terminalReason = "CANCELLED";
      controller.abort();
      reject(new OperationCancelledError());
    };
    externalSignal?.addEventListener("abort", onAbort, { once: true });
  });
  const operationResult = Promise.resolve()
    .then(() => operation(controller.signal))
    .then(
      (result) => {
        if (terminalReason === "CANCELLED") throw new OperationCancelledError();
        if (terminalReason === "TIMEOUT") throw new OperationTimeoutError();
        return result;
      },
      (error: unknown) => {
        if (terminalReason === "CANCELLED") throw new OperationCancelledError();
        if (terminalReason === "TIMEOUT") throw new OperationTimeoutError();
        throw error;
      }
    );
  try {
    return await Promise.race([operationResult, timeoutResult, cancellationResult]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (onAbort !== undefined) externalSignal?.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
