import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { JarvisError } from "../errors.js";
import type { LongTermMemoryStore, MemoryRecord, MemoryStoreLimits } from "./contracts.js";
import { MemoryRecordSet } from "./record-set.js";
import {
  checkMemorySignal,
  validateMemoryId,
  validateMemoryLimits
} from "./validation.js";

interface PersistedMemory {
  readonly schemaVersion: 1;
  readonly records: readonly MemoryRecord[];
}

export class JsonFileLongTermMemoryStore implements LongTermMemoryStore {
  readonly #filePath: string;
  readonly #limits: MemoryStoreLimits;
  #tail: Promise<void> = Promise.resolve();

  constructor(filePath: string, limits: MemoryStoreLimits) {
    if (!isAbsolute(filePath) || filePath.includes("\u0000")) throw invalidStore();
    this.#filePath = filePath;
    this.#limits = validateMemoryLimits(limits);
  }

  create(record: MemoryRecord, signal?: AbortSignal): Promise<MemoryRecord> {
    return this.#exclusive(async () => {
      checkMemorySignal(signal);
      const records = await this.#load();
      const created = records.create(record);
      await this.#persist(records, signal);
      return created;
    });
  }

  update(record: MemoryRecord, expectedVersion: number, signal?: AbortSignal): Promise<MemoryRecord> {
    return this.#exclusive(async () => {
      checkMemorySignal(signal);
      const records = await this.#load();
      const updated = records.update(record, expectedVersion);
      await this.#persist(records, signal);
      return updated;
    });
  }

  get(id: string, signal?: AbortSignal): Promise<MemoryRecord | undefined> {
    return this.#exclusive(async () => {
      checkMemorySignal(signal);
      return (await this.#load()).get(validateMemoryId(id));
    });
  }

  list(signal?: AbortSignal): Promise<readonly MemoryRecord[]> {
    return this.#exclusive(async () => {
      checkMemorySignal(signal);
      return (await this.#load()).list();
    });
  }

  delete(id: string, expectedVersion: number, signal?: AbortSignal): Promise<boolean> {
    return this.#exclusive(async () => {
      checkMemorySignal(signal);
      const records = await this.#load();
      const deleted = records.delete(validateMemoryId(id), expectedVersion);
      await this.#persist(records, signal);
      return deleted;
    });
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async #load(): Promise<MemoryRecordSet> {
    try {
      const file = await lstat(this.#filePath);
      if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0) throw unsafeStore();
      const content = await readFile(this.#filePath, { encoding: "utf8", flag: constants.O_RDONLY });
      const parsed: unknown = JSON.parse(content);
      if (!isPersistedMemory(parsed)) throw corruptStore();
      return new MemoryRecordSet(this.#limits, parsed.records);
    } catch (error) {
      if (isMissing(error)) return new MemoryRecordSet(this.#limits);
      if (error instanceof JarvisError) throw error;
      if (error instanceof SyntaxError) throw corruptStore();
      throw storageFailure();
    }
  }

  async #persist(records: MemoryRecordSet, signal: AbortSignal | undefined): Promise<void> {
    checkMemorySignal(signal);
    const directory = dirname(this.#filePath);
    const temporary = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const directoryInfo = await lstat(directory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o077) !== 0) {
        throw unsafeStore();
      }
      const document: PersistedMemory = { schemaVersion: 1, records: records.list() };
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      checkMemorySignal(signal);
      await rename(temporary, this.#filePath);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      if (error instanceof JarvisError) throw error;
      throw storageFailure();
    }
  }
}

function isPersistedMemory(value: unknown): value is PersistedMemory {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return keys.length === 2 && keys[0] === "records" && keys[1] === "schemaVersion" && record.schemaVersion === 1 && Array.isArray(record.records);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function invalidStore(): JarvisError {
  return new JarvisError("MEMORY_INVALID", 422, "Memory store configuration is invalid.");
}

function unsafeStore(): JarvisError {
  return new JarvisError("MEMORY_STORE_UNSAFE", 500, "Memory store permissions are unsafe.");
}

function corruptStore(): JarvisError {
  return new JarvisError("MEMORY_STORE_CORRUPT", 500, "Memory store is corrupt.");
}

function storageFailure(): JarvisError {
  return new JarvisError("MEMORY_STORAGE_FAILURE", 500, "Memory storage operation failed.");
}
