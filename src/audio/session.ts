import { JarvisError } from "../errors.js";
import { BoundedAudioBuffer } from "./buffer.js";
import type {
  AudioLimits,
  AudioSessionResult,
  AudioSessionState,
  VoiceActivity
} from "./contracts.js";
import type { MicrophoneInput } from "./input.js";
import type { VoiceActivityDetector } from "./vad.js";
import { DEFAULT_AUDIO_LIMITS } from "./validation.js";

export interface AudioSessionOptions {
  readonly timeoutMilliseconds: number;
  readonly cleanupTimeoutMilliseconds?: number;
  readonly limits?: AudioLimits;
}

const DEFAULT_CLEANUP_TIMEOUT_MILLISECONDS = 1_000;

export class AudioSession {
  readonly #input: MicrophoneInput;
  readonly #vad: VoiceActivityDetector;
  readonly #options: AudioSessionOptions;
  #state: AudioSessionState = "START";
  #hasRun = false;

  constructor(input: MicrophoneInput, vad: VoiceActivityDetector, options: AudioSessionOptions) {
    if (
      !isValidTimeout(options.timeoutMilliseconds) ||
      (options.cleanupTimeoutMilliseconds !== undefined &&
        !isValidTimeout(options.cleanupTimeoutMilliseconds))
    ) {
      throw new JarvisError("AUDIO_INVALID", 422, "Audio session timeout is invalid.");
    }
    this.#input = input;
    this.#vad = vad;
    this.#options = options;
  }

  get state(): AudioSessionState {
    return this.#state;
  }

  async run(signal?: AbortSignal): Promise<AudioSessionResult> {
    if (this.#hasRun) {
      throw new JarvisError("AUDIO_INVALID", 409, "Audio session has already run.");
    }
    this.#hasRun = true;
    const buffer = new BoundedAudioBuffer(this.#options.limits ?? DEFAULT_AUDIO_LIMITS);
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    if (signal?.aborted === true) {
      controller.abort();
    }
    const timeout = setTimeout(() => controller.abort(), this.#options.timeoutMilliseconds);
    this.#state = "LISTENING";

    try {
      this.#vad.reset();
      if (controller.signal.aborted) {
        return this.#incompleteResult(signal?.aborted === true ? "CANCELLED" : "TIMEOUT");
      }
      const iterator = this.#input.chunks(controller.signal)[Symbol.asyncIterator]();

      while (true) {
        const next = await nextChunk(iterator, controller.signal);
        if (next.kind === "aborted") {
          return this.#incompleteResult(signal?.aborted === true ? "CANCELLED" : "TIMEOUT");
        }
        if (next.kind === "error") {
          throw next.error;
        }
        if (next.result.done === true) {
          break;
        }

        const activityResult = await withAbort(
          () => this.#vad.process(next.result.value),
          controller.signal
        );
        if (activityResult.kind === "aborted") {
          return this.#incompleteResult(signal?.aborted === true ? "CANCELLED" : "TIMEOUT");
        }
        if (activityResult.kind === "error") {
          throw activityResult.error;
        }
        const activity = activityResult.value;
        this.#handleActivity(activity, next.result.value, buffer);
        if (activity === "SPEECH_END") {
          this.#state = "COMPLETE";
          return { state: "COMPLETE", audio: buffer.snapshot() };
        }
      }

      if (controller.signal.aborted) {
        return this.#incompleteResult(signal?.aborted === true ? "CANCELLED" : "TIMEOUT");
      }
      throw new JarvisError("AUDIO_INPUT_FAILURE", 500, "Audio input ended before speech completed.");
    } catch (error) {
      if (error instanceof JarvisError) {
        this.#state = "ERROR";
        throw error;
      }
      this.#state = "ERROR";
      throw new JarvisError("AUDIO_INPUT_FAILURE", 500, "Audio input failed.");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", forwardAbort);
      controller.abort();
      buffer.clear();
      let cleanupFailed = false;
      try {
        this.#vad.reset();
      } catch {
        cleanupFailed = true;
      }
      try {
        const closeResult = await withTimeout(
          () => this.#input.close(),
          this.#options.cleanupTimeoutMilliseconds ?? DEFAULT_CLEANUP_TIMEOUT_MILLISECONDS
        );
        if (closeResult.kind !== "value") {
          cleanupFailed = true;
        }
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed) {
        this.#state = "ERROR";
        throw new JarvisError("AUDIO_INPUT_FAILURE", 500, "Audio resource cleanup failed.");
      }
    }
  }

  #handleActivity(
    activity: VoiceActivity,
    chunk: Parameters<BoundedAudioBuffer["append"]>[0],
    buffer: BoundedAudioBuffer
  ): void {
    if (activity === "SPEECH_START") {
      this.#state = "SPEECH";
      buffer.append(chunk);
      return;
    }
    if (activity === "SPEECH" || activity === "SPEECH_END") {
      if (this.#state !== "SPEECH") {
        throw new JarvisError("AUDIO_INVALID", 422, "Voice activity transition is invalid.");
      }
      buffer.append(chunk);
    }
  }

  #incompleteResult(state: "TIMEOUT" | "CANCELLED"): AudioSessionResult {
    this.#state = state;
    return { state, audio: null };
  }
}

type NextChunkResult =
  | { readonly kind: "next"; readonly result: IteratorResult<import("./contracts.js").AudioChunk> }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "aborted" };

async function nextChunk(
  iterator: AsyncIterator<import("./contracts.js").AudioChunk>,
  signal: AbortSignal
): Promise<NextChunkResult> {
  const result = await withAbort(() => iterator.next(), signal);
  if (result.kind === "value") {
    return { kind: "next", result: result.value };
  }
  return result;
}

type AbortableResult<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "aborted" };

async function withAbort<T>(
  operation: () => Promise<T>,
  signal: AbortSignal
): Promise<AbortableResult<T>> {
  if (signal.aborted) {
    return { kind: "aborted" };
  }

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<AbortableResult<T>>((resolve) => {
    onAbort = () => resolve({ kind: "aborted" });
    signal.addEventListener("abort", onAbort, { once: true });
  });
  let promise: Promise<T>;
  try {
    promise = operation();
  } catch (error) {
    if (onAbort !== undefined) {
      signal.removeEventListener("abort", onAbort);
    }
    return { kind: "error", error };
  }
  const settled = promise.then<AbortableResult<T>, AbortableResult<T>>(
    (value) => ({ kind: "value", value }),
    (error: unknown) => ({ kind: "error", error })
  );

  try {
    return await Promise.race([settled, aborted]);
  } finally {
    if (onAbort !== undefined) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMilliseconds: number
): Promise<AbortableResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    return await withAbort(operation, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function isValidTimeout(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
