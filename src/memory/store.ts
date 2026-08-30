import type { LongTermMemoryStore, MemoryRecord, MemoryStoreLimits } from "./contracts.js";
import { MemoryRecordSet } from "./record-set.js";
import { checkMemorySignal, validateMemoryId } from "./validation.js";

export class InMemoryLongTermMemoryStore implements LongTermMemoryStore {
  readonly #records: MemoryRecordSet;

  constructor(limits: MemoryStoreLimits) {
    this.#records = new MemoryRecordSet(limits);
  }

  async create(record: MemoryRecord, signal?: AbortSignal): Promise<MemoryRecord> {
    checkMemorySignal(signal);
    return this.#records.create(record);
  }

  async update(record: MemoryRecord, expectedVersion: number, signal?: AbortSignal): Promise<MemoryRecord> {
    checkMemorySignal(signal);
    return this.#records.update(record, expectedVersion);
  }

  async get(id: string, signal?: AbortSignal): Promise<MemoryRecord | undefined> {
    checkMemorySignal(signal);
    return this.#records.get(validateMemoryId(id));
  }

  async list(signal?: AbortSignal): Promise<readonly MemoryRecord[]> {
    checkMemorySignal(signal);
    return this.#records.list();
  }

  async delete(id: string, expectedVersion: number, signal?: AbortSignal): Promise<boolean> {
    checkMemorySignal(signal);
    return this.#records.delete(validateMemoryId(id), expectedVersion);
  }
}
