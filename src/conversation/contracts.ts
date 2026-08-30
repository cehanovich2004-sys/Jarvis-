import type { StructuredCommand } from "../intents/contracts.js";

export type ConversationSource = "DETERMINISTIC" | "CONTEXT" | "LOCAL_LLM" | "SYSTEM";

export type ConversationOutcome =
  | { readonly kind: "INTENT"; readonly command: StructuredCommand }
  | { readonly kind: "ANSWER" }
  | { readonly kind: "NO_RESULT" };

export type ConversationToolSummary =
  | {
      readonly intent: "OPEN_APPLICATION";
      readonly status: "SUCCESS" | "FAILED";
      readonly application: "Safari" | "Finder";
    }
  | {
      readonly intent: "GET_BATTERY";
      readonly status: "SUCCESS";
      readonly percentage: number;
      readonly powerSource: "AC" | "BATTERY";
    }
  | { readonly intent: "GET_BATTERY"; readonly status: "FAILED" };

export interface ConversationTurnInput {
  readonly userText: string;
  readonly assistantText: string | null;
  readonly outcome: ConversationOutcome;
  readonly tool: ConversationToolSummary | null;
  readonly metadata: {
    readonly source: ConversationSource;
    readonly interactionState?: string;
  };
}

export interface ConversationTurn extends ConversationTurnInput {
  readonly sequence: number;
  readonly createdAt: string;
}

export interface ConversationSessionSnapshot {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly turns: readonly ConversationTurn[];
}

export interface ConversationStoreOptions {
  readonly ttlMilliseconds: number;
  readonly maxTurns: number;
  readonly maxCharacters: number;
  readonly now?: () => number;
}

export interface ConversationSessionStore {
  create(sessionId: string, signal?: AbortSignal): Promise<ConversationSessionSnapshot>;
  append(
    sessionId: string,
    turn: ConversationTurnInput,
    signal?: AbortSignal
  ): Promise<ConversationSessionSnapshot>;
  get(sessionId: string, signal?: AbortSignal): Promise<ConversationSessionSnapshot | undefined>;
  delete(sessionId: string, signal?: AbortSignal): Promise<boolean>;
}
