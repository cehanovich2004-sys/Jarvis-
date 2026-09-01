import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { createInterface, type Interface } from "node:readline";
import { JarvisError } from "../errors.js";
import type { SpeakerEmbeddingMetadata } from "./contracts.js";
import type {
  VoiceIDAudioInput,
  VoiceIDEmbeddingResult,
  VoiceIDRuntimeClient,
  VoiceIDSimilarityResult
} from "./runtime.js";

const MAX_RESPONSE_CHARACTERS = 131_072;

export interface PythonVoiceIDRuntimeOptions {
  readonly pythonExecutable: string;
  readonly bridgeScript: string;
  readonly voiceIdSourceDirectory: string;
  readonly modelCacheDirectory: string;
  readonly voiceIdDataDirectory?: string;
  readonly spawnProcess?: typeof spawn;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly signal?: AbortSignal;
  readonly abort?: () => void;
}

export class PythonVoiceIDRuntimeClient implements VoiceIDRuntimeClient {
  readonly #options: PythonVoiceIDRuntimeOptions;
  readonly #spawn: typeof spawn;
  #process: ChildProcessWithoutNullStreams | undefined;
  #reader: Interface | undefined;
  #nextRequestId = 1;
  #pending = new Map<number, PendingRequest>();
  #termination: Promise<boolean> | undefined;

  constructor(options: PythonVoiceIDRuntimeOptions) {
    for (const path of [
      options.pythonExecutable,
      options.bridgeScript,
      options.voiceIdSourceDirectory,
      options.modelCacheDirectory,
      ...(options.voiceIdDataDirectory === undefined ? [] : [options.voiceIdDataDirectory])
    ]) {
      if (!isAbsoluteSafePath(path)) throw unavailable();
    }
    this.#options = options;
    this.#spawn = options.spawnProcess ?? spawn;
  }

  async extractEmbedding(
    input: VoiceIDAudioInput,
    signal?: AbortSignal
  ): Promise<VoiceIDEmbeddingResult> {
    const bytes = Buffer.from(input.waveform.buffer, input.waveform.byteOffset, input.waveform.byteLength);
    const result = await this.#request("extract", {
      audioBase64: bytes.toString("base64"),
      sampleRateHz: input.sampleRateHz,
      channels: input.channels
    }, signal);
    return parseEmbeddingResult(result);
  }

  async compareEmbeddings(
    reference: Float32Array,
    candidate: Float32Array,
    metadata: SpeakerEmbeddingMetadata,
    signal?: AbortSignal
  ): Promise<VoiceIDSimilarityResult> {
    const result = await this.#request("compare", {
      reference: [...reference],
      candidate: [...candidate],
      metadata
    }, signal);
    return parseSimilarityResult(result);
  }

  async importEnrollmentProfile(
    participantCode: string,
    signal?: AbortSignal
  ): Promise<readonly VoiceIDEmbeddingResult[]> {
    if (!/^P[0-9]{4}$/u.test(participantCode)) throw unavailable();
    const result = await this.#request("importEnrollment", { participantCode }, signal);
    if (!isRecord(result) || result.status !== "VALID" || result.participantCode !== participantCode ||
        !Array.isArray(result.embeddings) || result.embeddings.length < 2 || result.embeddings.length > 16) {
      throw unavailable();
    }
    return result.embeddings.map(parseEmbeddingResult);
  }

  async close(): Promise<void> {
    this.#stop(new Error("VoiceID runtime closed."));
    if (this.#termination !== undefined && !(await this.#termination)) {
      throw unavailable();
    }
  }

  async #request(
    operation: "extract" | "compare" | "importEnrollment",
    payload: unknown,
    signal?: AbortSignal
  ): Promise<unknown> {
    if (signal?.aborted === true) throw signal.reason;
    await this.#ensureStarted();
    if (isAborted(signal)) {
      const reason = signal?.reason ?? new Error("VoiceID operation cancelled.");
      this.#stop(reason);
      throw reason;
    }
    const process = this.#process;
    if (process === undefined || process.stdin.destroyed) throw unavailable();
    const id = this.#nextRequestId++;
    return await new Promise((resolve, reject) => {
      const abort = signal === undefined ? undefined : (): void => {
        this.#stop(signal.reason ?? new Error("VoiceID operation cancelled."));
      };
      signal?.addEventListener("abort", abort as () => void, { once: true });
      this.#pending.set(id, { resolve, reject, ...(signal === undefined ? {} : { signal }), ...(abort === undefined ? {} : { abort }) });
      process.stdin.write(`${JSON.stringify({ id, operation, payload })}\n`, (error) => {
        if (error !== null && error !== undefined) this.#stop(unavailable());
      });
    });
  }

  async #ensureStarted(): Promise<void> {
    if (this.#process !== undefined) return;
    if (this.#termination !== undefined) {
      if (!(await this.#termination)) throw unavailable();
      this.#termination = undefined;
    }
    try {
      await Promise.all([
        access(this.#options.pythonExecutable),
        access(this.#options.bridgeScript),
        access(this.#options.voiceIdSourceDirectory),
        access(this.#options.modelCacheDirectory),
        ...(this.#options.voiceIdDataDirectory === undefined
          ? []
          : [access(this.#options.voiceIdDataDirectory)])
      ]);
    } catch {
      throw unavailable();
    }
    const process = this.#spawn(this.#options.pythonExecutable, ["-u", this.#options.bridgeScript], {
      shell: false,
      env: {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
        PYTHONPATH: this.#options.voiceIdSourceDirectory,
        JARVIS_VOICEID_CACHE_DIR: this.#options.modelCacheDirectory,
        ...(this.#options.voiceIdDataDirectory === undefined
          ? {}
          : { JARVIS_VOICEID_DATA_DIR: this.#options.voiceIdDataDirectory }),
        PYTHONNOUSERSITE: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.#process = process;
    process.stderr.resume();
    this.#reader = createInterface({ input: process.stdout });
    this.#reader.on("line", (line) => this.#handleLine(line));
    process.once("error", () => this.#stop(unavailable()));
    process.once("exit", () => this.#handleProcessExit(process));
  }

  #handleLine(line: string): void {
    if (line.length > MAX_RESPONSE_CHARACTERS) {
      this.#stop(unavailable());
      return;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed) || !Number.isSafeInteger(parsed.id) || !("result" in parsed)) throw unavailable();
      const id = parsed.id as number;
      const pending = this.#pending.get(id);
      if (pending === undefined) return;
      this.#pending.delete(id);
      removeAbort(pending);
      pending.resolve(parsed.result);
    } catch {
      this.#stop(unavailable());
    }
  }

  #stop(reason: unknown): void {
    const process = this.#process;
    this.#process = undefined;
    this.#reader?.close();
    this.#reader = undefined;
    if (process !== undefined && process.exitCode === null && process.signalCode === null) {
      process.kill("SIGKILL");
      this.#termination = waitForExit(process, 1_000);
    }
    for (const pending of this.#pending.values()) {
      removeAbort(pending);
      pending.reject(reason);
    }
    this.#pending.clear();
  }

  #handleProcessExit(process: ChildProcessWithoutNullStreams): void {
    if (this.#process === process) {
      this.#stop(unavailable());
    }
  }
}

function removeAbort(pending: PendingRequest): void {
  if (pending.signal !== undefined && pending.abort !== undefined) {
    pending.signal.removeEventListener("abort", pending.abort);
  }
}

function parseEmbeddingResult(value: unknown): VoiceIDEmbeddingResult {
  if (!isRecord(value) || (value.status !== "VALID" && value.status !== "INVALID")) return invalidEmbedding();
  if (value.status === "INVALID") return { status: "INVALID", errorCode: readEmbeddingError(value.errorCode) };
  if (!Array.isArray(value.embedding) || !isRecord(value.metadata)) return invalidEmbedding();
  return {
    status: "VALID",
    embedding: Float32Array.from(value.embedding as number[]),
    metadata: value.metadata as unknown as SpeakerEmbeddingMetadata
  };
}

function parseSimilarityResult(value: unknown): VoiceIDSimilarityResult {
  if (!isRecord(value) || (value.status !== "VALID" && value.status !== "INVALID")) {
    return { status: "INVALID", errorCode: "COMPARISON_ERROR" };
  }
  if (value.status === "INVALID") return { status: "INVALID", errorCode: readSimilarityError(value.errorCode) };
  return value as unknown as VoiceIDSimilarityResult;
}

function readEmbeddingError(value: unknown): Extract<VoiceIDEmbeddingResult, { status: "INVALID" }>["errorCode"] {
  const allowed = new Set([
    "INVALID_PREPROCESSED_AUDIO", "UNSUPPORTED_SAMPLE_RATE", "EMPTY_WAVEFORM", "NON_FINITE_WAVEFORM",
    "ZERO_OR_NEAR_ZERO_WAVEFORM", "MODEL_NOT_LOADED", "MODEL_LOAD_FAILED", "MODEL_CACHE_MISSING",
    "MODEL_CACHE_CORRUPTED", "INFERENCE_FAILED", "INVALID_EMBEDDING_SHAPE", "INVALID_EMBEDDING_DTYPE",
    "NON_FINITE_EMBEDDING", "MEMORY_LIMIT_EXCEEDED"
  ]);
  return typeof value === "string" && allowed.has(value)
    ? value as Extract<VoiceIDEmbeddingResult, { status: "INVALID" }>["errorCode"]
    : "INFERENCE_FAILED";
}

function readSimilarityError(value: unknown): Extract<VoiceIDSimilarityResult, { status: "INVALID" }>["errorCode"] {
  const allowed = new Set([
    "INVALID_REFERENCE", "INVALID_CANDIDATE", "INVALID_EMBEDDING", "ZERO_OR_NEAR_ZERO_EMBEDDING",
    "INCOMPATIBLE_EMBEDDINGS", "COMPARISON_ERROR"
  ]);
  return typeof value === "string" && allowed.has(value)
    ? value as Extract<VoiceIDSimilarityResult, { status: "INVALID" }>["errorCode"]
    : "COMPARISON_ERROR";
}

function invalidEmbedding(): VoiceIDEmbeddingResult {
  return { status: "INVALID", errorCode: "INFERENCE_FAILED" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbsoluteSafePath(value: string): boolean {
  return value.startsWith("/") && !value.includes("\0") && !value.includes("\n") && !value.includes("\r");
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function waitForExit(
  process: ChildProcessWithoutNullStreams,
  timeoutMilliseconds: number
): Promise<boolean> {
  if (process.exitCode !== null || process.signalCode !== null) return true;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<true>((resolve) => process.once("exit", () => resolve(true))),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMilliseconds);
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function unavailable(): JarvisError {
  return new JarvisError("SPEAKER_MODEL_UNAVAILABLE", 503, "Speaker model is unavailable.");
}
