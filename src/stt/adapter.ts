import { performance } from "node:perf_hooks";
import type { AudioData } from "../audio/contracts.js";
import { validateAudioChunk } from "../audio/validation.js";
import { JarvisError } from "../errors.js";
import {
  DEFAULT_MAX_TRANSCRIPT_CHARACTERS,
  type STTBackendMetadata,
  type STTLanguageMode,
  type TranscriptResult,
  type TranscriptStatus
} from "./contracts.js";
import type { STTRuntimeClient, STTRuntimeErrorCode, STTRuntimeResult } from "./runtime.js";

export interface SpeechToTextAdapterOptions {
  readonly timeoutMilliseconds?: number;
  readonly maxTranscriptCharacters?: number;
}

export class SpeechToTextAdapter {
  readonly #runtime: STTRuntimeClient;
  readonly #metadata: STTBackendMetadata;
  readonly #timeoutMilliseconds: number;
  readonly #maxTranscriptCharacters: number;

  constructor(runtime: STTRuntimeClient, options: SpeechToTextAdapterOptions = {}) {
    this.#runtime = runtime;
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 30_000;
    this.#maxTranscriptCharacters =
      options.maxTranscriptCharacters ?? DEFAULT_MAX_TRANSCRIPT_CHARACTERS;
    validatePositiveInteger(this.#timeoutMilliseconds);
    validatePositiveInteger(this.#maxTranscriptCharacters);
    validateBackendMetadata(runtime.metadata);
    this.#metadata = { ...runtime.metadata };
  }

  async transcribe(
    audio: AudioData,
    languageMode: STTLanguageMode,
    signal?: AbortSignal
  ): Promise<TranscriptResult> {
    if (languageMode !== "AUTO" && languageMode !== "RU" && languageMode !== "EN") {
      throw new JarvisError("STT_INVALID_RESPONSE", 500, "STT language configuration is invalid.");
    }
    const snapshot = snapshotAudio(audio);
    const startedAt = performance.now();
    let runtimeResult: STTRuntimeResult;
    try {
      runtimeResult = await runBounded(
        (operationSignal) =>
          this.#runtime.transcribe(
            {
              waveform: snapshot.samples,
              sampleRateHz: 16_000,
              channels: 1,
              format: "pcm-f32",
              languageMode
            },
            operationSignal
          ),
        this.#timeoutMilliseconds,
        signal
      );
    } catch (error) {
      if (error instanceof OperationCancelledError) {
        throw new JarvisError("STT_CANCELLED", 499, "Speech transcription was cancelled.");
      }
      if (error instanceof OperationTimeoutError) {
        throw new JarvisError("STT_TIMEOUT", 504, "Speech transcription timed out.");
      }
      throw runtimeFailure();
    }

    try {
      if (typeof runtimeResult !== "object" || runtimeResult === null) {
        throw invalidResponse();
      }
      if (runtimeResult.status === "INVALID") {
        throw mapRuntimeError(runtimeResult.errorCode);
      }
      return validateTranscriptResult(
        runtimeResult,
        snapshot.durationSeconds,
        finiteElapsed(startedAt),
        this.#metadata,
        this.#maxTranscriptCharacters
      );
    } catch (error) {
      if (error instanceof JarvisError) {
        throw error;
      }
      throw invalidResponse();
    }
  }
}

function snapshotAudio(audio: AudioData): AudioData {
  try {
    const snapshot: AudioData = {
      sampleRate: audio.sampleRate,
      channels: audio.channels,
      format: audio.format,
      samples: audio.samples.slice(),
      durationSeconds: audio.durationSeconds
    };
    validateAudioChunk(snapshot);
    if (snapshot.durationSeconds !== snapshot.samples.length / snapshot.sampleRate) {
      throw new Error("Audio duration mismatch.");
    }
    return snapshot;
  } catch {
    throw new JarvisError("STT_INVALID_AUDIO", 422, "Audio is invalid for transcription.");
  }
}

function validateTranscriptResult(
  result: Exclude<STTRuntimeResult, { readonly status: "INVALID" }>,
  durationSeconds: number,
  transcriptionLatencyMs: number,
  metadata: STTBackendMetadata,
  maxCharacters: number
): TranscriptResult {
  if (!isTranscriptStatus(result.status) || typeof result.text !== "string") {
    throw invalidResponse();
  }
  if (hasInvalidUnicode(result.text) || hasControlGarbage(result.text)) {
    throw invalidResponse();
  }
  const text = result.text.replace(/\s+/gu, " ").trim();
  if (text.length > maxCharacters) {
    throw invalidResponse();
  }
  if (result.status === "EMPTY" ? text !== "" : text === "") {
    throw invalidResponse();
  }
  if (
    result.language !== undefined &&
    (typeof result.language !== "string" || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(result.language))
  ) {
    throw invalidResponse();
  }
  if (
    result.confidence !== undefined &&
    (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1)
  ) {
    throw invalidResponse();
  }
  if (
    result.languageConfidence !== undefined &&
    (result.language === undefined ||
      !Number.isFinite(result.languageConfidence) ||
      result.languageConfidence < 0 ||
      result.languageConfidence > 1)
  ) {
    throw invalidResponse();
  }

  return {
    status: result.status,
    text,
    ...(result.language === undefined ? {} : { language: result.language }),
    ...(result.confidence === undefined ? {} : { confidence: result.confidence }),
    ...(result.languageConfidence === undefined
      ? {}
      : { languageConfidence: result.languageConfidence }),
    durationSeconds,
    transcriptionLatencyMs,
    backendMetadata: { ...metadata }
  };
}

function validateBackendMetadata(metadata: STTBackendMetadata): void {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !isSafeMetadataValue(metadata.backend) ||
    !isSafeMetadataValue(metadata.model) ||
    (metadata.backendVersion !== undefined && !isSafeMetadataValue(metadata.backendVersion))
  ) {
    throw new JarvisError("STT_INVALID_RESPONSE", 500, "STT runtime configuration is invalid.");
  }
}

function isSafeMetadataValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value &&
    !hasInvalidUnicode(value) &&
    !/[\u0000-\u001F\u007F-\u009F]/u.test(value)
  );
}

function isTranscriptStatus(status: unknown): status is TranscriptStatus {
  return status === "SUCCESS" || status === "EMPTY" || status === "UNCERTAIN";
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
    throw new JarvisError("STT_INVALID_RESPONSE", 500, "STT adapter configuration is invalid.");
  }
}

function mapRuntimeError(code: STTRuntimeErrorCode): JarvisError {
  if (code === "INVALID_AUDIO") {
    return new JarvisError("STT_INVALID_AUDIO", 422, "Audio is invalid for transcription.");
  }
  if (code === "MODEL_UNAVAILABLE") {
    return new JarvisError("STT_MODEL_UNAVAILABLE", 503, "Speech model is unavailable.");
  }
  return runtimeFailure();
}

function runtimeFailure(): JarvisError {
  return new JarvisError("STT_RUNTIME_FAILURE", 502, "Speech transcription failed.");
}

function invalidResponse(): JarvisError {
  return new JarvisError("STT_INVALID_RESPONSE", 502, "STT runtime returned an invalid response.");
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
      if (terminalReason !== undefined) {
        return;
      }
      terminalReason = "TIMEOUT";
      controller.abort();
      reject(new OperationTimeoutError());
    }, timeoutMilliseconds);
  });
  const cancellationResult = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      if (terminalReason !== undefined) {
        return;
      }
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
        if (terminalReason === "CANCELLED") {
          throw new OperationCancelledError();
        }
        if (terminalReason === "TIMEOUT") {
          throw new OperationTimeoutError();
        }
        return result;
      },
      (error: unknown) => {
        if (terminalReason === "CANCELLED") {
          throw new OperationCancelledError();
        }
        if (terminalReason === "TIMEOUT") {
          throw new OperationTimeoutError();
        }
        throw error;
      }
    );
  try {
    return await Promise.race([operationResult, timeoutResult, cancellationResult]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (onAbort !== undefined) {
      externalSignal?.removeEventListener("abort", onAbort);
    }
    controller.abort();
  }
}
