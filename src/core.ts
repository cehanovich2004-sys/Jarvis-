import { randomUUID } from "node:crypto";
import type { CommandKind, CommandRecord, CreateCommandRequest, SupportedCommandText } from "./contracts.js";
import { JarvisError } from "./errors.js";
import type { CommandRepository } from "./repository.js";
import { parseSupportedCommandText } from "./validation.js";

export class JarvisCore {
  readonly #repository: CommandRepository;

  constructor(repository: CommandRepository) {
    this.#repository = repository;
  }

  async ask(request: CreateCommandRequest): Promise<CommandRecord> {
    const normalizedText = parseSupportedCommandText(request.text);
    const now = new Date().toISOString();
    const record: CommandRecord = {
      id: request.id ?? randomUUID(),
      text: request.text,
      normalizedText,
      kind: kindForText(normalizedText),
      state: "completed",
      response: responseForText(normalizedText),
      createdAt: now,
      completedAt: now
    };

    return this.#repository.create(record);
  }

  async getCommand(id: string): Promise<CommandRecord> {
    const command = await this.#repository.get(id);
    if (command === undefined) {
      throw new JarvisError("COMMAND_NOT_FOUND", 404, "Command was not found.", {
        id
      });
    }

    return command;
  }
}

function kindForText(text: SupportedCommandText): CommandKind {
  return text === "статус" ? "status" : "help";
}

function responseForText(text: SupportedCommandText): string {
  if (text === "статус") {
    return "JARVIS Core работает локально. Доступны команды: статус, помощь.";
  }

  return "Доступные команды: статус, помощь.";
}

