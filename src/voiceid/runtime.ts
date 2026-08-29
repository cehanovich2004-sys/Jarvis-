import type { SpeakerEmbeddingMetadata } from "./contracts.js";

export type VoiceIDEmbeddingErrorCode =
  | "INVALID_PREPROCESSED_AUDIO"
  | "UNSUPPORTED_SAMPLE_RATE"
  | "EMPTY_WAVEFORM"
  | "NON_FINITE_WAVEFORM"
  | "ZERO_OR_NEAR_ZERO_WAVEFORM"
  | "MODEL_NOT_LOADED"
  | "MODEL_LOAD_FAILED"
  | "MODEL_CACHE_MISSING"
  | "MODEL_CACHE_CORRUPTED"
  | "INFERENCE_FAILED"
  | "INVALID_EMBEDDING_SHAPE"
  | "INVALID_EMBEDDING_DTYPE"
  | "NON_FINITE_EMBEDDING"
  | "MEMORY_LIMIT_EXCEEDED";

export type VoiceIDSimilarityErrorCode =
  | "INVALID_REFERENCE"
  | "INVALID_CANDIDATE"
  | "INVALID_EMBEDDING"
  | "ZERO_OR_NEAR_ZERO_EMBEDDING"
  | "INCOMPATIBLE_EMBEDDINGS"
  | "COMPARISON_ERROR";

export interface VoiceIDAudioInput {
  readonly waveform: Float32Array;
  readonly sampleRateHz: number;
  readonly channels: 1;
  readonly format: "pcm-f32";
}

export type VoiceIDEmbeddingResult =
  | {
      readonly status: "VALID";
      readonly embedding: Float32Array;
      readonly metadata: SpeakerEmbeddingMetadata;
    }
  | {
      readonly status: "INVALID";
      readonly errorCode: VoiceIDEmbeddingErrorCode;
    };

export type VoiceIDSimilarityResult =
  | {
      readonly status: "VALID";
      readonly similarity: number;
      readonly metric: "cosine_similarity";
      readonly comparisonVersion: string;
      readonly embeddingDimension: number;
      readonly normalized: boolean;
    }
  | {
      readonly status: "INVALID";
      readonly errorCode: VoiceIDSimilarityErrorCode;
    };

export interface VoiceIDRuntimeClient {
  /** Apply VoiceID phase3-v1 preprocessing before embedding extraction. */
  extractEmbedding(input: VoiceIDAudioInput, signal?: AbortSignal): Promise<VoiceIDEmbeddingResult>;
  /** Delegate comparison to VoiceID's Phase 5A cosine implementation. */
  compareEmbeddings(
    reference: Float32Array,
    candidate: Float32Array,
    metadata: SpeakerEmbeddingMetadata,
    signal?: AbortSignal
  ): Promise<VoiceIDSimilarityResult>;
}
