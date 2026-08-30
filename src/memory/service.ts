import { randomUUID } from "node:crypto";
import { JarvisError } from "../errors.js";
import type {
  LongTermMemoryServiceOptions,
  LongTermMemoryStore,
  MemoryCandidate,
  MemoryQuery,
  MemoryRecord,
  MemoryRetrievalResult,
  MemoryWriteApproval
} from "./contracts.js";
import {
  checkMemorySignal,
  validateMemoryApproval,
  validateMemoryCandidate,
  validateMemoryId,
  validateMemoryQuery,
  validateMemoryRecord
} from "./validation.js";

export class LongTermMemoryService {
  readonly #store: LongTermMemoryStore;
  readonly #now: () => number;
  readonly #idFactory: () => string;

  constructor(store: LongTermMemoryStore, options: LongTermMemoryServiceOptions = {}) {
    this.#store = store;
    this.#now = options.now ?? Date.now;
    this.#idFactory = options.idFactory ?? randomUUID;
  }

  async create(
    candidate: MemoryCandidate,
    approval: MemoryWriteApproval,
    signal?: AbortSignal
  ): Promise<MemoryRecord> {
    checkMemorySignal(signal);
    const input = validateMemoryCandidate(candidate);
    const consent = validateMemoryApproval(approval);
    const timestamp = this.#timestamp();
    const record: MemoryRecord = {
      ...input,
      id: validateMemoryId(this.#idFactory()),
      approval: { ...consent, approvedAt: timestamp },
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1
    };
    return this.#validatedStoreResult(await this.#store.create(record, signal), record);
  }

  async update(
    id: string,
    expectedVersion: number,
    candidate: MemoryCandidate,
    approval: MemoryWriteApproval,
    signal?: AbortSignal
  ): Promise<MemoryRecord> {
    checkMemorySignal(signal);
    const memoryId = validateMemoryId(id);
    const stored = await this.#store.get(memoryId, signal);
    if (stored === undefined) throw new JarvisError("MEMORY_NOT_FOUND", 404, "Memory record was not found.");
    const current = this.#validatedStoreResult(stored);
    if (!Number.isSafeInteger(expectedVersion) || current.version !== expectedVersion) {
      throw new JarvisError("MEMORY_CONFLICT", 409, "Memory record version conflict.");
    }
    const input = validateMemoryCandidate(candidate);
    const consent = validateMemoryApproval(approval);
    const timestamp = this.#timestamp();
    const updated: MemoryRecord = {
      ...input,
      id: current.id,
      approval: { ...consent, approvedAt: timestamp },
      createdAt: current.createdAt,
      updatedAt: timestamp,
      version: current.version + 1
    };
    return this.#validatedStoreResult(
      await this.#store.update(updated, expectedVersion, signal),
      updated
    );
  }

  async delete(id: string, expectedVersion: number, signal?: AbortSignal): Promise<boolean> {
    checkMemorySignal(signal);
    return this.#store.delete(validateMemoryId(id), expectedVersion, signal);
  }

  async retrieve(query: MemoryQuery = {}, signal?: AbortSignal): Promise<MemoryRetrievalResult> {
    checkMemorySignal(signal);
    const validated = validateMemoryQuery(query);
    const records = (await this.#store.list(signal))
      .map((record) => this.#validatedStoreResult(record))
      .filter((record) => validated.categories === undefined || validated.categories.includes(record.category))
      .filter((record) => validated.key === undefined || record.key === validated.key)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, validated.limit);
    return { trust: "UNTRUSTED_CONTEXT", records: structuredClone(records) };
  }

  #timestamp(): string {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0) throw new JarvisError("MEMORY_INVALID", 422, "Memory data is invalid.");
    return new Date(value).toISOString();
  }

  #validatedStoreResult(value: unknown, expected?: MemoryRecord): MemoryRecord {
    try {
      const record = validateMemoryRecord(value);
      if (expected !== undefined && JSON.stringify(record) !== JSON.stringify(expected)) {
        throw new Error("Store returned a different record.");
      }
      return record;
    } catch {
      throw new JarvisError("MEMORY_STORE_CORRUPT", 500, "Memory store is corrupt.");
    }
  }
}
