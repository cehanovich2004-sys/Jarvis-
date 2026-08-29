import { performance } from "node:perf_hooks";
import type { AudioData } from "../audio/contracts.js";
import { JarvisError } from "../errors.js";
import { VoiceIDAdapter } from "./adapter.js";
import {
  MAX_OWNER_REFERENCE_EMBEDDINGS,
  type OwnerSpeakerProfileSummary,
  type SpeakerDecision,
  type SpeakerDecisionPolicy,
  type SpeakerVerificationResult
} from "./contracts.js";
import {
  buildOwnerSpeakerProfile,
  type OwnerSpeakerProfileRepository,
  validateProfile
} from "./profile.js";

export interface SpeakerRecognitionServiceOptions {
  readonly adapter: VoiceIDAdapter;
  readonly profiles: OwnerSpeakerProfileRepository;
  readonly decisionPolicy: SpeakerDecisionPolicy;
  readonly now?: () => Date;
}

export class SpeakerRecognitionService {
  readonly #adapter: VoiceIDAdapter;
  readonly #profiles: OwnerSpeakerProfileRepository;
  readonly #decisionPolicy: SpeakerDecisionPolicy;
  readonly #now: () => Date;

  constructor(options: SpeakerRecognitionServiceOptions) {
    if (
      !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(options.decisionPolicy.policyId) ||
      typeof options.decisionPolicy.calibrationRequired !== "boolean"
    ) {
      throw verificationFailure();
    }
    this.#adapter = options.adapter;
    this.#profiles = options.profiles;
    this.#decisionPolicy = options.decisionPolicy;
    this.#now = options.now ?? (() => new Date());
  }

  async enrollOwner(
    profileId: string,
    audioSamples: readonly AudioData[]
  ): Promise<OwnerSpeakerProfileSummary> {
    if (
      audioSamples.length < 2 ||
      audioSamples.length > MAX_OWNER_REFERENCE_EMBEDDINGS
    ) {
      throw new JarvisError(
        "SPEAKER_PROFILE_INCOMPATIBLE",
        422,
        "Owner enrollment requires multiple audio samples."
      );
    }
    const embeddings = [];
    for (const audio of audioSamples) {
      embeddings.push(await this.#adapter.extractEmbedding(audio));
    }
    const profile = buildOwnerSpeakerProfile(profileId, embeddings, this.#now().toISOString());
    try {
      await this.#profiles.put(profile);
    } catch (error) {
      if (error instanceof JarvisError) {
        throw error;
      }
      throw verificationFailure();
    }
    const reference = profile.referenceEmbeddings[0];
    if (reference === undefined) {
      throw verificationFailure();
    }
    return {
      profileId: profile.profileId,
      referenceCount: profile.referenceEmbeddings.length,
      modelIdentifier: reference.metadata.modelIdentifier,
      modelRevision: reference.metadata.modelRevision,
      createdAt: profile.createdAt
    };
  }

  async verifySpeaker(audio: AudioData, profileId: string): Promise<SpeakerVerificationResult> {
    const startedAt = performance.now();
    let profile;
    try {
      profile = await this.#profiles.get(profileId);
    } catch {
      throw verificationFailure();
    }
    if (profile === undefined) {
      throw new JarvisError("SPEAKER_PROFILE_NOT_FOUND", 404, "Owner speaker profile was not found.");
    }
    validateProfile(profile);

    const candidate = await this.#adapter.extractEmbedding(audio);
    const similarities: number[] = [];
    for (const reference of profile.referenceEmbeddings) {
      similarities.push(await this.#adapter.compare(reference, candidate));
    }
    let decision: SpeakerDecision;
    try {
      decision = this.#decisionPolicy.decide(similarities);
    } catch (error) {
      if (error instanceof JarvisError) {
        throw error;
      }
      throw verificationFailure();
    }
    validateDecision(decision);
    const reference = profile.referenceEmbeddings[0];
    if (reference === undefined) {
      throw new JarvisError("SPEAKER_VERIFICATION_FAILURE", 502, "Speaker verification failed.");
    }

    return {
      status: decision.status,
      similarity: decision.similarity,
      ...(decision.authorizedThreshold === undefined
        ? {}
        : { authorizedThreshold: decision.authorizedThreshold }),
      ...(decision.unauthorizedThreshold === undefined
        ? {}
        : { unauthorizedThreshold: decision.unauthorizedThreshold }),
      metadata: {
        profileId: profile.profileId,
        referencesCompared: profile.referenceEmbeddings.length,
        modelIdentifier: reference.metadata.modelIdentifier,
        modelRevision: reference.metadata.modelRevision,
        embeddingLatencyMs: candidate.embeddingLatencyMs,
        verificationLatencyMs: finiteElapsed(startedAt),
        decisionPolicyId: this.#decisionPolicy.policyId,
        calibrationRequired: this.#decisionPolicy.calibrationRequired
      }
    };
  }
}

function finiteElapsed(startedAt: number): number {
  const elapsed = performance.now() - startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}

function validateDecision(decision: SpeakerDecision): void {
  if (typeof decision !== "object" || decision === null) {
    throw verificationFailure();
  }
  const hasAuthorizedThreshold = decision.authorizedThreshold !== undefined;
  const hasUnauthorizedThreshold = decision.unauthorizedThreshold !== undefined;
  if (
    !["AUTHORIZED", "UNAUTHORIZED", "UNCERTAIN"].includes(decision.status) ||
    !isSimilarity(decision.similarity) ||
    (decision.authorizedThreshold !== undefined &&
      !isSimilarity(decision.authorizedThreshold)) ||
    (decision.unauthorizedThreshold !== undefined &&
      !isSimilarity(decision.unauthorizedThreshold)) ||
    hasAuthorizedThreshold !== hasUnauthorizedThreshold
  ) {
    throw verificationFailure();
  }
  if (
    decision.authorizedThreshold !== undefined &&
    decision.unauthorizedThreshold !== undefined
  ) {
    if (decision.unauthorizedThreshold >= decision.authorizedThreshold) {
      throw verificationFailure();
    }
    const expectedStatus =
      decision.similarity >= decision.authorizedThreshold
        ? "AUTHORIZED"
        : decision.similarity <= decision.unauthorizedThreshold
          ? "UNAUTHORIZED"
          : "UNCERTAIN";
    if (decision.status !== expectedStatus) {
      throw verificationFailure();
    }
  }
}

function isSimilarity(value: number): boolean {
  return Number.isFinite(value) && value >= -1 && value <= 1;
}

function verificationFailure(): JarvisError {
  return new JarvisError("SPEAKER_VERIFICATION_FAILURE", 502, "Speaker verification failed.");
}
