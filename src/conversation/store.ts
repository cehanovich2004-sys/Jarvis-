import { JarvisError } from "../errors.js";
import { validateStructuredCommand } from "../intents/validation.js";
import type {
  ConversationSessionSnapshot,
  ConversationSessionStore,
  ConversationStoreOptions,
  ConversationToolSummary,
  ConversationTurn,
  ConversationTurnInput
} from "./contracts.js";

interface StoredSession {
  readonly sessionId: string;
  readonly createdAtMs: number;
  expiresAtMs: number;
  nextSequence: number;
  turns: ConversationTurn[];
}

export class InMemoryConversationSessionStore implements ConversationSessionStore {
  readonly #sessions = new Map<string, StoredSession>();
  readonly #ttlMilliseconds: number;
  readonly #maxTurns: number;
  readonly #maxCharacters: number;
  readonly #now: () => number;

  constructor(options: ConversationStoreOptions) {
    for (const value of [options.ttlMilliseconds, options.maxTurns, options.maxCharacters]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw invalidConversation();
    }
    this.#ttlMilliseconds = options.ttlMilliseconds;
    this.#maxTurns = options.maxTurns;
    this.#maxCharacters = options.maxCharacters;
    this.#now = options.now ?? Date.now;
  }

  async create(sessionId: string, signal?: AbortSignal): Promise<ConversationSessionSnapshot> {
    checkSignal(signal);
    validateSessionId(sessionId);
    const now = this.#safeNow();
    const existing = this.#sessions.get(sessionId);
    if (existing !== undefined && now < existing.expiresAtMs) throw invalidConversation();
    if (existing !== undefined) this.#sessions.delete(sessionId);
    const session: StoredSession = {
      sessionId,
      createdAtMs: now,
      expiresAtMs: now + this.#ttlMilliseconds,
      nextSequence: 1,
      turns: []
    };
    this.#sessions.set(sessionId, session);
    return snapshot(session);
  }

  async append(
    sessionId: string,
    input: ConversationTurnInput,
    signal?: AbortSignal
  ): Promise<ConversationSessionSnapshot> {
    checkSignal(signal);
    validateSessionId(sessionId);
    const now = this.#safeNow();
    const session = this.#activeSession(sessionId, now);
    const turn = validateTurn(input, session.nextSequence, now);
    if (characters(turn) > this.#maxCharacters) throw invalidConversation();
    session.nextSequence += 1;
    session.turns.push(turn);
    while (
      session.turns.length > this.#maxTurns ||
      session.turns.reduce((total, item) => total + characters(item), 0) > this.#maxCharacters
    ) {
      session.turns.shift();
    }
    session.expiresAtMs = now + this.#ttlMilliseconds;
    return snapshot(session);
  }

  async get(
    sessionId: string,
    signal?: AbortSignal
  ): Promise<ConversationSessionSnapshot | undefined> {
    checkSignal(signal);
    validateSessionId(sessionId);
    const session = this.#sessions.get(sessionId);
    if (session === undefined) return undefined;
    if (this.#safeNow() >= session.expiresAtMs) {
      this.#sessions.delete(sessionId);
      return undefined;
    }
    return snapshot(session);
  }

  async delete(sessionId: string, signal?: AbortSignal): Promise<boolean> {
    checkSignal(signal);
    validateSessionId(sessionId);
    return this.#sessions.delete(sessionId);
  }

  #activeSession(sessionId: string, now: number): StoredSession {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) throw notFound();
    if (now >= session.expiresAtMs) {
      this.#sessions.delete(sessionId);
      throw new JarvisError("CONVERSATION_EXPIRED", 410, "Conversation session expired.");
    }
    return session;
  }

  #safeNow(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0) throw invalidConversation();
    return value;
  }
}

function validateTurn(input: ConversationTurnInput, sequence: number, now: number): ConversationTurn {
  if (typeof input !== "object" || input === null) throw invalidConversation();
  if (!exactKeys(input as unknown as Record<string, unknown>, ["assistantText", "metadata", "outcome", "tool", "userText"])) {
    throw invalidConversation();
  }
  if (
    typeof input.outcome !== "object" || input.outcome === null ||
    typeof input.metadata !== "object" || input.metadata === null ||
    (input.tool !== null && (typeof input.tool !== "object" || input.tool === null))
  ) throw invalidConversation();
  const outcomeKeys = input.outcome.kind === "INTENT" ? ["command", "kind"] : ["kind"];
  if (!exactKeys(input.outcome as unknown as Record<string, unknown>, outcomeKeys)) {
    throw invalidConversation();
  }
  const metadataKeys = input.metadata.interactionState === undefined
    ? ["source"]
    : ["interactionState", "source"];
  if (!exactKeys(input.metadata as unknown as Record<string, unknown>, metadataKeys)) {
    throw invalidConversation();
  }
  const userText = safeText(input.userText);
  const assistantText = input.assistantText === null ? null : safeText(input.assistantText);
  if (!new Set(["DETERMINISTIC", "CONTEXT", "LOCAL_LLM", "SYSTEM"]).has(input.metadata?.source)) {
    throw invalidConversation();
  }
  if (
    input.metadata.interactionState !== undefined &&
    !/^[A-Z_]{2,64}$/.test(input.metadata.interactionState)
  ) throw invalidConversation();
  if (input.outcome.kind === "INTENT") {
    try {
      if (!exactKeys(input.outcome.command as unknown as Record<string, unknown>, ["confidence", "intent", "parameters"])) {
        throw invalidConversation();
      }
      validateStructuredCommand(input.outcome.command);
    } catch { throw invalidConversation(); }
  } else if (input.outcome.kind !== "ANSWER" && input.outcome.kind !== "NO_RESULT") {
    throw invalidConversation();
  }
  validateTool(input.tool);
  if (
    input.tool !== null &&
    (input.outcome.kind !== "INTENT" || input.outcome.command.intent !== input.tool.intent)
  ) throw invalidConversation();
  return structuredClone({
    userText,
    assistantText,
    outcome: input.outcome,
    tool: input.tool,
    metadata: input.metadata,
    sequence,
    createdAt: new Date(now).toISOString()
  });
}

function validateTool(tool: ConversationToolSummary | null): void {
  if (tool === null) return;
  if (tool.intent === "OPEN_APPLICATION") {
    if (!exactKeys(tool as unknown as Record<string, unknown>, ["application", "intent", "status"])) {
      throw invalidConversation();
    }
    if (!new Set(["SUCCESS", "FAILED"]).has(tool.status) || !new Set(["Safari", "Finder"]).has(tool.application)) {
      throw invalidConversation();
    }
    return;
  }
  if (tool.intent === "GET_BATTERY") {
    if (tool.status === "FAILED") {
      if (!exactKeys(tool as unknown as Record<string, unknown>, ["intent", "status"])) {
        throw invalidConversation();
      }
      return;
    }
    if (!exactKeys(tool as unknown as Record<string, unknown>, ["intent", "percentage", "powerSource", "status"])) {
      throw invalidConversation();
    }
    if (!Number.isInteger(tool.percentage) || tool.percentage < 0 || tool.percentage > 100 || !new Set(["AC", "BATTERY"]).has(tool.powerSource)) {
      throw invalidConversation();
    }
    return;
  }
  throw invalidConversation();
}

function safeText(value: unknown): string {
  if (typeof value !== "string") throw invalidConversation();
  const text = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    text.length === 0 || text.length > 2_000 ||
    /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u.test(text) ||
    /(?:api[_ -]?key|password|passwd|secret|authorization|bearer|token)\s*[:=]\s*\S+/iu.test(text)
  ) throw invalidConversation();
  return text;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function characters(turn: ConversationTurn): number {
  return turn.userText.length + (turn.assistantText?.length ?? 0);
}

function snapshot(session: StoredSession): ConversationSessionSnapshot {
  return structuredClone({
    sessionId: session.sessionId,
    createdAt: new Date(session.createdAtMs).toISOString(),
    expiresAt: new Date(session.expiresAtMs).toISOString(),
    turns: session.turns
  });
}

function validateSessionId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(value)) {
    throw invalidConversation();
  }
}

function checkSignal(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new JarvisError("CONVERSATION_CANCELLED", 499, "Conversation operation was cancelled.");
  }
}

function invalidConversation(): JarvisError {
  return new JarvisError("CONVERSATION_INVALID", 422, "Conversation data is invalid.");
}
function notFound(): JarvisError {
  return new JarvisError("CONVERSATION_NOT_FOUND", 404, "Conversation session was not found.");
}
