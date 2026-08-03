import type { CommandRecord } from "./contracts.js";
import { JarvisError } from "./errors.js";

export interface CommandRepository {
  create(record: CommandRecord): Promise<CommandRecord>;
  get(id: string): Promise<CommandRecord | undefined>;
}

export class InMemoryCommandRepository implements CommandRepository {
  readonly #records = new Map<string, CommandRecord>();

  async create(record: CommandRecord): Promise<CommandRecord> {
    if (this.#records.has(record.id)) {
      throw new JarvisError("COMMAND_ID_CONFLICT", 409, "Command id already exists.", {
        id: record.id
      });
    }

    this.#records.set(record.id, record);
    return record;
  }

  async get(id: string): Promise<CommandRecord | undefined> {
    return this.#records.get(id);
  }
}

