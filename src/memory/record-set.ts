import { JarvisError } from "../errors.js";
import type { MemoryRecord, MemoryStoreLimits } from "./contracts.js";
import { validateMemoryLimits, validateMemoryRecord } from "./validation.js";

export class MemoryRecordSet {
  readonly #records = new Map<string, MemoryRecord>();
  readonly #limits: MemoryStoreLimits;

  constructor(limits: MemoryStoreLimits, records: readonly unknown[] = []) {
    this.#limits = validateMemoryLimits(limits);
    try {
      for (const input of records) {
        const record = validateMemoryRecord(input);
        if (this.#records.has(record.id) || this.#duplicate(record, record.id) !== undefined) throw corrupt();
        this.#records.set(record.id, record);
      }
      this.#checkCapacity("MEMORY_STORE_CORRUPT");
    } catch {
      throw corrupt();
    }
  }

  create(input: MemoryRecord): MemoryRecord {
    const record = validateMemoryRecord(input);
    if (this.#records.has(record.id) || this.#duplicate(record) !== undefined) {
      throw new JarvisError("MEMORY_DUPLICATE", 409, "Memory record already exists.");
    }
    this.#records.set(record.id, record);
    try {
      this.#checkCapacity("MEMORY_CAPACITY_EXCEEDED");
    } catch (error) {
      this.#records.delete(record.id);
      throw error;
    }
    return clone(record);
  }

  update(input: MemoryRecord, expectedVersion: number): MemoryRecord {
    const record = validateMemoryRecord(input);
    const current = this.#records.get(record.id);
    if (current === undefined) throw notFound();
    if (!Number.isSafeInteger(expectedVersion) || current.version !== expectedVersion || record.version !== expectedVersion + 1) throw conflict();
    if (record.createdAt !== current.createdAt) throw conflict();
    if (this.#duplicate(record, record.id) !== undefined) throw new JarvisError("MEMORY_DUPLICATE", 409, "Memory record already exists.");
    this.#records.set(record.id, record);
    try {
      this.#checkCapacity("MEMORY_CAPACITY_EXCEEDED");
    } catch (error) {
      this.#records.set(current.id, current);
      throw error;
    }
    return clone(record);
  }

  get(id: string): MemoryRecord | undefined {
    const record = this.#records.get(id);
    return record === undefined ? undefined : clone(record);
  }

  list(): readonly MemoryRecord[] {
    return [...this.#records.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map(clone);
  }

  delete(id: string, expectedVersion: number): boolean {
    const record = this.#records.get(id);
    if (record === undefined) throw notFound();
    if (!Number.isSafeInteger(expectedVersion) || record.version !== expectedVersion) throw conflict();
    return this.#records.delete(id);
  }

  #duplicate(record: MemoryRecord, excludedId?: string): MemoryRecord | undefined {
    return [...this.#records.values()].find(
      (item) => item.id !== excludedId && item.category === record.category && item.key === record.key
    );
  }

  #checkCapacity(code: "MEMORY_CAPACITY_EXCEEDED" | "MEMORY_STORE_CORRUPT"): void {
    const characters = [...this.#records.values()].reduce(
      (total, record) => total + record.key.length + record.value.length,
      0
    );
    if (this.#records.size > this.#limits.maxRecords || characters > this.#limits.maxTotalCharacters) {
      throw new JarvisError(code, code === "MEMORY_STORE_CORRUPT" ? 500 : 409, code === "MEMORY_STORE_CORRUPT" ? "Memory store is corrupt." : "Memory capacity was exceeded.");
    }
  }
}

function clone(record: MemoryRecord): MemoryRecord {
  return structuredClone(record);
}

function notFound(): JarvisError {
  return new JarvisError("MEMORY_NOT_FOUND", 404, "Memory record was not found.");
}

function conflict(): JarvisError {
  return new JarvisError("MEMORY_CONFLICT", 409, "Memory record version conflict.");
}

function corrupt(): JarvisError {
  return new JarvisError("MEMORY_STORE_CORRUPT", 500, "Memory store is corrupt.");
}
