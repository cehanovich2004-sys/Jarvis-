import assert from "node:assert/strict";
import { test } from "node:test";
import type { AudioData } from "../../src/audio/contracts.js";
import {
  InMemoryOwnerSpeakerProfileRepository,
  SpeakerRecognitionService,
  ThresholdDecisionPolicy,
  VoiceIDAdapter,
  VOICEID_BACKEND_NAME,
  VOICEID_BACKEND_VERSION,
  VOICEID_COMPARISON_VERSION,
  VOICEID_EMBEDDING_CONTRACT_VERSION,
  VOICEID_EMBEDDING_DIMENSION,
  VOICEID_MODEL_IDENTIFIER,
  VOICEID_MODEL_REVISION,
  VOICEID_PREPROCESSING_CONTRACT_VERSION,
  VOICEID_SAMPLE_RATE_HZ,
  type SpeakerEmbeddingMetadata,
  type VoiceIDAudioInput,
  type VoiceIDEmbeddingResult,
  type VoiceIDRuntimeClient,
  type VoiceIDSimilarityResult
} from "../../src/voiceid/index.js";

class DeterministicVoiceIDRuntime implements VoiceIDRuntimeClient {
  async extractEmbedding(input: VoiceIDAudioInput): Promise<VoiceIDEmbeddingResult> {
    const embedding = new Float32Array(VOICEID_EMBEDDING_DIMENSION);
    embedding[0] = input.waveform[0] ?? 0;
    embedding[1] = 1;
    return { status: "VALID", embedding, metadata: voiceIDMetadata() };
  }

  async compareEmbeddings(
    reference: Float32Array,
    candidate: Float32Array
  ): Promise<VoiceIDSimilarityResult> {
    const score = reference[0] === candidate[0] ? 0.9 : 0.2;
    return {
      status: "VALID",
      similarity: score,
      metric: "cosine_similarity",
      comparisonVersion: VOICEID_COMPARISON_VERSION,
      embeddingDimension: VOICEID_EMBEDDING_DIMENSION,
      normalized: false
    };
  }
}

function voiceIDMetadata(): SpeakerEmbeddingMetadata {
  return {
    embeddingDimension: VOICEID_EMBEDDING_DIMENSION,
    modelIdentifier: VOICEID_MODEL_IDENTIFIER,
    modelRevision: VOICEID_MODEL_REVISION,
    backendName: VOICEID_BACKEND_NAME,
    backendVersion: VOICEID_BACKEND_VERSION,
    preprocessingContractVersion: VOICEID_PREPROCESSING_CONTRACT_VERSION,
    embeddingContractVersion: VOICEID_EMBEDDING_CONTRACT_VERSION,
    inputSampleRateHz: VOICEID_SAMPLE_RATE_HZ,
    normalized: false
  };
}

function audio(firstSample: number): AudioData {
  const samples = new Float32Array([firstSample, 0.25]);
  return {
    sampleRate: VOICEID_SAMPLE_RATE_HZ,
    channels: 1,
    format: "pcm-f32",
    samples,
    durationSeconds: samples.length / VOICEID_SAMPLE_RATE_HZ
  };
}

test("JARVIS audio enrolls and verifies through the isolated VoiceID runtime boundary", async () => {
  const recognition = new SpeakerRecognitionService({
    adapter: new VoiceIDAdapter(new DeterministicVoiceIDRuntime()),
    profiles: new InMemoryOwnerSpeakerProfileRepository(),
    decisionPolicy: new ThresholdDecisionPolicy({
      authorizedThreshold: 0.8,
      unauthorizedThreshold: 0.3,
      policyId: "integration-calibration-required"
    }),
    now: () => new Date("2026-08-29T00:00:00.000Z")
  });

  await recognition.enrollOwner("owner-main", [audio(0.5), audio(0.5), audio(0.5)]);
  const authorized = await recognition.verifySpeaker(audio(0.5), "owner-main");
  const unauthorized = await recognition.verifySpeaker(audio(-0.5), "owner-main");

  assert.equal(authorized.status, "AUTHORIZED");
  assert.equal(authorized.metadata.referencesCompared, 3);
  assert.equal(unauthorized.status, "UNAUTHORIZED");
  assert.equal("referenceEmbeddings" in authorized, false);
});
