import { JarvisError } from "../errors.js";
import { assertCompatible, validateEmbedding } from "./adapter.js";
import {
  MAX_OWNER_REFERENCE_EMBEDDINGS,
  type OwnerSpeakerProfile,
  type SpeakerEmbedding
} from "./contracts.js";

const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/;

export interface OwnerSpeakerProfileRepository {
  get(profileId: string): Promise<OwnerSpeakerProfile | undefined>;
  put(profile: OwnerSpeakerProfile): Promise<void>;
  delete?(profileId: string): Promise<boolean>;
}

export class InMemoryOwnerSpeakerProfileRepository implements OwnerSpeakerProfileRepository {
  readonly #profiles = new Map<string, OwnerSpeakerProfile>();

  async get(profileId: string): Promise<OwnerSpeakerProfile | undefined> {
    const profile = this.#profiles.get(profileId);
    return profile === undefined ? undefined : copyProfile(profile);
  }

  async put(profile: OwnerSpeakerProfile): Promise<void> {
    validateProfile(profile);
    this.#profiles.set(profile.profileId, copyProfile(profile));
  }

  async delete(profileId: string): Promise<boolean> {
    return this.#profiles.delete(profileId);
  }
}

export function buildOwnerSpeakerProfile(
  profileId: string,
  referenceEmbeddings: readonly SpeakerEmbedding[],
  createdAt: string
): OwnerSpeakerProfile {
  const profile = { profileId, referenceEmbeddings, createdAt };
  validateProfile(profile);
  return copyProfile(profile);
}

export function validateProfile(profile: OwnerSpeakerProfile): void {
  if (
    typeof profile !== "object" ||
    profile === null ||
    typeof profile.profileId !== "string" ||
    !PROFILE_ID_PATTERN.test(profile.profileId) ||
    !Array.isArray(profile.referenceEmbeddings) ||
    typeof profile.createdAt !== "string"
  ) {
    throw invalidProfile();
  }
  if (
    profile.referenceEmbeddings.length < 2 ||
    profile.referenceEmbeddings.length > MAX_OWNER_REFERENCE_EMBEDDINGS
  ) {
    throw invalidProfile();
  }
  if (!isIsoDate(profile.createdAt)) {
    throw invalidProfile();
  }

  const first = profile.referenceEmbeddings[0];
  if (first === undefined) {
    throw invalidProfile();
  }
  validateEmbedding(first);
  for (const embedding of profile.referenceEmbeddings.slice(1)) {
    validateEmbedding(embedding);
    assertCompatible(first.metadata, embedding.metadata);
  }
}

function copyProfile(profile: OwnerSpeakerProfile): OwnerSpeakerProfile {
  return {
    profileId: profile.profileId,
    referenceEmbeddings: profile.referenceEmbeddings.map(copyEmbedding),
    createdAt: profile.createdAt
  };
}

function copyEmbedding(embedding: SpeakerEmbedding): SpeakerEmbedding {
  return {
    values: embedding.values.slice(),
    metadata: { ...embedding.metadata },
    embeddingLatencyMs: embedding.embeddingLatencyMs
  };
}

function isIsoDate(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function invalidProfile(): JarvisError {
  return new JarvisError("SPEAKER_PROFILE_INCOMPATIBLE", 409, "Speaker profile is invalid.");
}
