export const VOICEID_SAMPLE_RATE_HZ = 16_000;
export const VOICEID_EMBEDDING_DIMENSION = 192;
export const VOICEID_MODEL_IDENTIFIER = "speechbrain/spkrec-ecapa-voxceleb";
export const VOICEID_MODEL_REVISION = "0f99f2d0ebe89ac095bcc5903c4dd8f72b367286";
export const VOICEID_BACKEND_NAME = "speechbrain-ecapa-tdnn";
export const VOICEID_BACKEND_VERSION = "speechbrain-ecapa-adapter-v1";
export const VOICEID_PREPROCESSING_CONTRACT_VERSION = "phase3-v1";
export const VOICEID_EMBEDDING_CONTRACT_VERSION = "phase4b-v1";
export const VOICEID_COMPARISON_VERSION = "1";
export const VOICEID_SIMILARITY_METRIC = "cosine_similarity";
export const VOICEID_MIN_EMBEDDING_L2_NORM = 1e-8;
export const MAX_OWNER_REFERENCE_EMBEDDINGS = 16;

export type SpeakerVerificationStatus = "AUTHORIZED" | "UNAUTHORIZED" | "UNCERTAIN";

export interface SpeakerEmbeddingMetadata {
  readonly embeddingDimension: number;
  readonly modelIdentifier: string;
  readonly modelRevision: string;
  readonly backendName: string;
  readonly backendVersion: string;
  readonly preprocessingContractVersion: string;
  readonly embeddingContractVersion: string;
  readonly inputSampleRateHz: number;
  readonly normalized: boolean;
}

export interface SpeakerEmbedding {
  readonly values: Float32Array;
  readonly metadata: SpeakerEmbeddingMetadata;
  readonly embeddingLatencyMs: number;
}

export interface OwnerSpeakerProfile {
  readonly profileId: string;
  readonly referenceEmbeddings: readonly SpeakerEmbedding[];
  readonly createdAt: string;
}

export interface OwnerSpeakerProfileSummary {
  readonly profileId: string;
  readonly referenceCount: number;
  readonly modelIdentifier: string;
  readonly modelRevision: string;
  readonly createdAt: string;
}

export interface SpeakerVerificationMetadata {
  readonly profileId: string;
  readonly referencesCompared: number;
  readonly modelIdentifier: string;
  readonly modelRevision: string;
  readonly embeddingLatencyMs: number;
  readonly verificationLatencyMs: number;
  readonly decisionPolicyId: string;
  readonly calibrationRequired: boolean;
}

export interface SpeakerVerificationResult {
  readonly status: SpeakerVerificationStatus;
  readonly similarity: number;
  readonly authorizedThreshold?: number;
  readonly unauthorizedThreshold?: number;
  readonly metadata: SpeakerVerificationMetadata;
}

export interface SpeakerDecision {
  readonly status: SpeakerVerificationStatus;
  readonly similarity: number;
  readonly authorizedThreshold?: number;
  readonly unauthorizedThreshold?: number;
}

export interface SpeakerDecisionPolicy {
  readonly policyId: string;
  readonly calibrationRequired: boolean;
  decide(similarities: readonly number[]): SpeakerDecision;
}
