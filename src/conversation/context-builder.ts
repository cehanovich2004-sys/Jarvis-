import { JarvisError } from "../errors.js";
import type { ConversationSessionSnapshot, ConversationTurn } from "./contracts.js";

export class ConversationContextBuilder {
  readonly #maxCharacters: number;
  readonly #maxTurns: number;

  constructor(options: { readonly maxCharacters?: number; readonly maxTurns?: number } = {}) {
    this.#maxCharacters = options.maxCharacters ?? 1_500;
    this.#maxTurns = options.maxTurns ?? 4;
    if (!Number.isSafeInteger(this.#maxCharacters) || this.#maxCharacters <= 0 || !Number.isSafeInteger(this.#maxTurns) || this.#maxTurns <= 0) {
      throw new JarvisError("CONVERSATION_INVALID", 422, "Context configuration is invalid.");
    }
  }

  build(session: ConversationSessionSnapshot, currentText: string): string {
    const header = `Current: ${JSON.stringify(currentText)}`;
    if (header.length > this.#maxCharacters) {
      throw new JarvisError("CONVERSATION_INVALID", 422, "Conversation context is too large.");
    }
    const lines: string[] = [];
    for (const turn of [...session.turns].reverse().slice(0, this.#maxTurns)) {
      const line = summarize(turn);
      const candidate = [header, "Recent structured context:", ...[...lines, line].reverse()].join("\n");
      if (candidate.length > this.#maxCharacters) break;
      lines.push(line);
    }
    return [header, ...(lines.length === 0 ? [] : ["Recent structured context:", ...lines.reverse()])].join("\n");
  }
}

function summarize(turn: ConversationTurn): string {
  if (turn.tool?.intent === "GET_BATTERY" && turn.tool.status === "SUCCESS") {
    return `turn=${turn.sequence}; intent=GET_BATTERY; battery=${turn.tool.percentage}; power=${turn.tool.powerSource}`;
  }
  if (turn.outcome.kind === "INTENT") {
    const command = turn.outcome.command;
    return command.intent === "OPEN_APPLICATION"
      ? `turn=${turn.sequence}; intent=OPEN_APPLICATION; application=${command.parameters.application}; result=${turn.tool?.status ?? "UNKNOWN"}`
      : `turn=${turn.sequence}; intent=GET_BATTERY; result=${turn.tool?.status ?? "UNKNOWN"}`;
  }
  return `turn=${turn.sequence}; user=${JSON.stringify(turn.userText)}; assistant=${JSON.stringify(turn.assistantText ?? "")}`;
}
