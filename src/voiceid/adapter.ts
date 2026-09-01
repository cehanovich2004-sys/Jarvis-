import { performance } from "node:perf_hooks";
import type { AudioData } from "../audio/contracts.js";
import { validateAudioChunk } from "../audio/validation.js";
import { JarvisError } from "../errors.js";
import {
  VOICEID_BACKEND_NAME,
  VOICEID_BACKEND_VERSION,
  VOICEID_COMPARISON_VERSION,
  VOICEID_EMBEDDING_CONTRACT_VERSION,
  VOICEID_EMBEDDING_DIMENSION,
  VOICEID_MIN_EMBEDDING_L2_NORM,
  VOICEID_MODEL_IDENTIFIER,
  VOICEID_MODEL_REVISION,
  VOICEID_PREPROCESSING_CONTRACT_VERSION,
  VOICEID_SAMPLE_RATE_HZ,
  VOICEID_SIMILARITY_METRIC,
  type SpeakerEmbedding,
  type SpeakerEmbeddingMetadata
} from "./contracts.js";
import type {
  VoiceIDEmbeddingErrorCode,
  VoiceIDRuntimeClient,
  VoiceIDSimilarityErrorCode
} from "./runtime.js";

export class VoiceIDAdapter {
  readonly #runtime: VoiceIDRuntimeClient;
  readonly #operationTimeoutMilliseconds: number;

  constructor(runtime: VoiceIDRuntimeClient, operationTimeoutMilliseconds = 30_000) {
    if (!Number.isSafeInteger(operationTimeoutMilliseconds) || operationTimeoutMilliseconds <= 0) {
      throw new JarvisError(
        "SPEAKER_VERIFICATION_FAILURE",
        500,
        "VoiceID runtime configuration is invalid."
      );
    }
    this.#runtime = runtime;
    this.#operationTimeoutMilliseconds = operationTimeoutMilliseconds;
  }

  async extractEmbedding(audio: AudioData, signal?: AbortSignal): Promise<SpeakerEmbedding> {
    validateVoiceIDAudio(audio);
    const input = {
      waveform: audio.samples.slice(),
      sampleRateHz: audio.sampleRate,
      channels: 1 as const,
      format: "pcm-f32" as const
    };
    const startedAt = performance.now();
    let result;
    try {
      result = await withTimeout(
        (signal) => this.#runtime.extractEmbedding(input, signal),
        this.#operationTimeoutMilliseconds,
        signal
      );
    } catch {
      throw embeddingFailure();
    }

    try {
      if (typeof result !== "object" || result === null) {
        throw embeddingFailure();
      }
      if (result.status === "INVALID") {
        throw mapEmbeddingError(result.errorCode);
      }
      if (result.status !== "VALID") {
        throw embeddingFailure();
      }
      validateMetadata(result.metadata);
      validateEmbeddingValues(result.embedding);
    } catch (error) {
      if (error instanceof JarvisError) {
        throw error;
      }
      throw embeddingFailure();
    }

    return {
      values: result.embedding.slice(),
      metadata: { ...result.metadata },
      embeddingLatencyMs: finiteElapsed(startedAt)
    };
  }

  async compare(
    reference: SpeakerEmbedding,
    candidate: SpeakerEmbedding,
    signal?: AbortSignal
  ): Promise<number> {
    validateEmbedding(reference);
    validateEmbedding(candidate);
    assertCompatible(reference.metadata, candidate.metadata);

    let result;
    try {
      result = await withTimeout(
        (signal) =>
          this.#runtime.compareEmbeddings(
            reference.values.slice(),
            candidate.values.slice(),
            { ...reference.metadata },
            signal
          ),
        this.#operationTimeoutMilliseconds,
        signal
      );
    } catch {
      throw verificationFailure();
    }

    try {
      if (typeof result !== "object" || result === null) {
        throw verificationFailure();
      }
      if (result.status === "INVALID") {
        throw mapSimilarityError(result.errorCode);
      }
      if (
        result.status !== "VALID" ||
        !Number.isFinite(result.similarity) ||
        result.similarity < -1 ||
        result.similarity > 1 ||
        result.metric !== VOICEID_SIMILARITY_METRIC ||
        result.comparisonVersion !== VOICEID_COMPARISON_VERSION ||
        result.embeddingDimension !== VOICEID_EMBEDDING_DIMENSION ||
        result.normalized !== reference.metadata.normalized
      ) {
        throw verificationFailure();
      }
    } catch (error) {
      if (error instanceof JarvisError) {
        throw error;
      }
      throw verificationFailure();
    }
    return result.similarity;
  }
}

export function validateEmbedding(embedding: SpeakerEmbedding): void {
  if (
    typeof embedding !== "object" ||
    embedding === null ||
    !Number.isFinite(embedding.embeddingLatencyMs) ||
    embedding.embeddingLatencyMs < 0
  ) {
    throw invalidEmbedding();
  }
  validateMetadata(embedding.metadata);
  validateEmbeddingValues(embedding.values);
}

export function assertCompatible(
  reference: SpeakerEmbeddingMetadata,
  candidate: SpeakerEmbeddingMetadata
): void {
  validateMetadata(reference);
  validateMetadata(candidate);
  if (
    reference.embeddingDimension !== candidate.embeddingDimension ||
    reference.modelIdentifier !== candidate.modelIdentifier ||
    reference.modelRevision !== candidate.modelRevision ||
    reference.backendName !== candidate.backendName ||
    reference.backendVersion !== candidate.backendVersion ||
    reference.preprocessingContractVersion !== candidate.preprocessingContractVersion ||
    reference.embeddingContractVersion !== candidate.embeddingContractVersion ||
    reference.inputSampleRateHz !== candidate.inputSampleRateHz ||
    reference.normalized !== candidate.normalized
  ) {
    throw new JarvisError(
      "SPEAKER_PROFILE_INCOMPATIBLE",
      409,
      "Speaker profile is incompatible with the active VoiceID runtime."
    );
  }
}

function validateVoiceIDAudio(audio: AudioData): void {
  try {
    validateAudioChunk(audio);
  } catch {
    throw new JarvisError("SPEAKER_INVALID_AUDIO", 422, "Audio is invalid for speaker recognition.");
  }
  const expectedDuration = audio.samples.length / VOICEID_SAMPLE_RATE_HZ;
  if (
    !Number.isFinite(audio.durationSeconds) ||
    audio.durationSeconds <= 0 ||
    audio.durationSeconds !== expectedDuration
  ) {
    throw new JarvisError("SPEAKER_INVALID_AUDIO", 422, "Audio is invalid for speaker recognition.");
  }
}

function validateMetadata(metadata: SpeakerEmbeddingMetadata): void {
  if (typeof metadata !== "object" || metadata === null) {
    throw invalidEmbedding();
  }
  if (metadata.embeddingDimension !== VOICEID_EMBEDDING_DIMENSION) {
    throw invalidEmbedding();
  }
  if (
    metadata.modelIdentifier !== VOICEID_MODEL_IDENTIFIER ||
    metadata.modelRevision !== VOICEID_MODEL_REVISION ||
    metadata.backendName !== VOICEID_BACKEND_NAME ||
    metadata.backendVersion !== VOICEID_BACKEND_VERSION ||
    metadata.preprocessingContractVersion !== VOICEID_PREPROCESSING_CONTRACT_VERSION ||
    metadata.embeddingContractVersion !== VOICEID_EMBEDDING_CONTRACT_VERSION ||
    metadata.inputSampleRateHz !== VOICEID_SAMPLE_RATE_HZ ||
    metadata.normalized !== false
  ) {
    throw new JarvisError(
      "SPEAKER_PROFILE_INCOMPATIBLE",
      409,
      "Speaker profile is incompatible with the active VoiceID runtime."
    );
  }
}

function validateEmbeddingValues(values: Float32Array): void {
  if (!(values instanceof Float32Array) || values.length !== VOICEID_EMBEDDING_DIMENSION) {
    throw invalidEmbedding();
  }
  let squaredNorm = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw invalidEmbedding();
    }
    squaredNorm += value * value;
  }
  const norm = Math.sqrt(squaredNorm);
  if (!Number.isFinite(norm) || norm <= VOICEID_MIN_EMBEDDING_L2_NORM) {
    throw invalidEmbedding();
  }
}

function mapEmbeddingError(code: VoiceIDEmbeddingErrorCode): JarvisError {
  if (
    code === "INVALID_PREPROCESSED_AUDIO" ||
    code === "UNSUPPORTED_SAMPLE_RATE" ||
    code === "EMPTY_WAVEFORM" ||
    code === "NON_FINITE_WAVEFORM" ||
    code === "ZERO_OR_NEAR_ZERO_WAVEFORM"
  ) {
    return new JarvisError("SPEAKER_INVALID_AUDIO", 422, "Audio is invalid for speaker recognition.");
  }
  if (
    code === "MODEL_NOT_LOADED" ||
    code === "MODEL_LOAD_FAILED" ||
    code === "MODEL_CACHE_MISSING" ||
    code === "MODEL_CACHE_CORRUPTED"
  ) {
    return new JarvisError("SPEAKER_MODEL_UNAVAILABLE", 503, "Speaker model is unavailable.");
  }
  if (
    code === "INVALID_EMBEDDING_SHAPE" ||
    code === "INVALID_EMBEDDING_DTYPE" ||
    code === "NON_FINITE_EMBEDDING"
  ) {
    return invalidEmbedding();
  }
  return embeddingFailure();
}

function mapSimilarityError(code: VoiceIDSimilarityErrorCode): JarvisError {
  if (code === "INCOMPATIBLE_EMBEDDINGS") {
    return new JarvisError(
      "SPEAKER_PROFILE_INCOMPATIBLE",
      409,
      "Speaker profile is incompatible with the active VoiceID runtime."
    );
  }
  if (
    code === "INVALID_REFERENCE" ||
    code === "INVALID_CANDIDATE" ||
    code === "INVALID_EMBEDDING" ||
    code === "ZERO_OR_NEAR_ZERO_EMBEDDING"
  ) {
    return invalidEmbedding();
  }
  return verificationFailure();
}

function invalidEmbedding(): JarvisError {
  return new JarvisError("SPEAKER_INVALID_EMBEDDING", 502, "VoiceID returned an invalid embedding.");
}

function embeddingFailure(): JarvisError {
  return new JarvisError("SPEAKER_EMBEDDING_FAILURE", 502, "Speaker embedding extraction failed.");
}

function verificationFailure(): JarvisError {
  return new JarvisError("SPEAKER_VERIFICATION_FAILURE", 502, "Speaker verification failed.");
}

function finiteElapsed(startedAt: number): number {
  const elapsed = performance.now() - startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMilliseconds: number,
  externalSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const cancel = (): void => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted === true) cancel();
  else externalSignal?.addEventListener("abort", cancel, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("VoiceID operation timed out."));
    }, timeoutMilliseconds);
  });
  const operationResult = Promise.resolve().then(() => operation(controller.signal));
  try {
    return await Promise.race([operationResult, timedOut]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    controller.abort();
    externalSignal?.removeEventListener("abort", cancel);
  }
}
