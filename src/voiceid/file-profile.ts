import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { JarvisError } from "../errors.js";
import type { OwnerSpeakerProfile, SpeakerEmbedding } from "./contracts.js";
import { type OwnerSpeakerProfileRepository, validateProfile } from "./profile.js";

const MAX_PROFILE_BYTES = 256 * 1024;

export class JsonOwnerSpeakerProfileRepository implements OwnerSpeakerProfileRepository {
  readonly #filePath: string;

  constructor(filePath: string) {
    if (!filePath.startsWith("/") || filePath.includes("\0")) throw storageFailure();
    this.#filePath = filePath;
  }

  async get(profileId: string): Promise<OwnerSpeakerProfile | undefined> {
    await this.#assertSafeParent();
    try {
      const stat = await lstat(this.#filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > MAX_PROFILE_BYTES) {
        throw incompatible();
      }
      const raw = await readFile(this.#filePath, "utf8");
      const profile = deserializeProfile(JSON.parse(raw));
      return profile.profileId === profileId ? profile : undefined;
    } catch (error) {
      if (isMissing(error)) return undefined;
      if (error instanceof JarvisError) throw error;
      throw incompatible();
    }
  }

  async put(profile: OwnerSpeakerProfile): Promise<void> {
    validateProfile(profile);
    await this.#assertSafeParent(true);
    const temporary = `${this.#filePath}.${process.pid}.tmp`;
    try {
      const serialized = JSON.stringify(serializeProfile(profile));
      if (Buffer.byteLength(serialized) > MAX_PROFILE_BYTES) throw incompatible();
      await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await chmod(temporary, 0o600);
      await rename(temporary, this.#filePath);
      await chmod(this.#filePath, 0o600);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      if (error instanceof JarvisError) throw error;
      throw storageFailure();
    }
  }

  async delete(profileId: string): Promise<boolean> {
    const profile = await this.get(profileId);
    if (profile === undefined) return false;
    try {
      await unlink(this.#filePath);
      return true;
    } catch {
      throw storageFailure();
    }
  }

  async #assertSafeParent(create = false): Promise<void> {
    const parent = dirname(this.#filePath);
    if (create) await mkdir(parent, { recursive: true, mode: 0o700 });
    try {
      const stat = await lstat(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw storageFailure();
      await access(parent, constants.R_OK | constants.W_OK);
    } catch (error) {
      if (!create && isMissing(error)) return;
      if (error instanceof JarvisError) throw error;
      throw storageFailure();
    }
  }
}

function serializeProfile(profile: OwnerSpeakerProfile): unknown {
  return {
    schemaVersion: 1,
    profileId: profile.profileId,
    createdAt: profile.createdAt,
    referenceEmbeddings: profile.referenceEmbeddings.map((embedding) => ({
      values: [...embedding.values],
      metadata: embedding.metadata,
      embeddingLatencyMs: embedding.embeddingLatencyMs
    }))
  };
}

function deserializeProfile(value: unknown): OwnerSpeakerProfile {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.profileId !== "string" ||
      typeof value.createdAt !== "string" || !Array.isArray(value.referenceEmbeddings) ||
      !hasOnly(value, ["schemaVersion", "profileId", "createdAt", "referenceEmbeddings"])) {
    throw incompatible();
  }
  const referenceEmbeddings = value.referenceEmbeddings.map(deserializeEmbedding);
  const profile = { profileId: value.profileId, createdAt: value.createdAt, referenceEmbeddings };
  validateProfile(profile);
  return profile;
}

function deserializeEmbedding(value: unknown): SpeakerEmbedding {
  if (!isRecord(value) || !Array.isArray(value.values) || !isRecord(value.metadata) ||
      typeof value.embeddingLatencyMs !== "number" ||
      !hasOnly(value, ["values", "metadata", "embeddingLatencyMs"])) throw incompatible();
  return {
    values: Float32Array.from(value.values as number[]),
    metadata: value.metadata as unknown as SpeakerEmbedding["metadata"],
    embeddingLatencyMs: value.embeddingLatencyMs
  };
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && Object.keys(value).length === keys.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function incompatible(): JarvisError {
  return new JarvisError("SPEAKER_PROFILE_INCOMPATIBLE", 409, "Speaker profile is invalid.");
}

function storageFailure(): JarvisError {
  return new JarvisError("SPEAKER_VERIFICATION_FAILURE", 500, "Speaker profile storage failed.");
}
