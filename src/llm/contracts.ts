import type { StructuredCommand } from "../intents/contracts.js";

export const DEFAULT_MAX_LLM_INPUT_CHARACTERS = 4_096;
export const DEFAULT_MAX_LLM_OUTPUT_CHARACTERS = 2_000;

export interface LocalLLMMetadata {
  readonly backend: string;
  readonly model: string;
}

export type LocalIntelligenceResult =
  | {
      readonly kind: "ANSWER";
      readonly text: string;
      readonly latencyMs: number;
      readonly metadata: LocalLLMMetadata;
    }
  | {
      readonly kind: "INTENT_PROPOSAL";
      readonly command: StructuredCommand;
      readonly latencyMs: number;
      readonly metadata: LocalLLMMetadata;
    }
  | {
      readonly kind: "NO_RESULT";
      readonly latencyMs: number;
      readonly metadata: LocalLLMMetadata;
    };

export interface LocalLLMOptions {
  readonly signal?: AbortSignal;
}

export interface LocalLLMProvider {
  interpret(input: string, options?: LocalLLMOptions): Promise<LocalIntelligenceResult>;
}

export type IntelligenceRoutingResult =
  | { readonly source: "DETERMINISTIC"; readonly kind: "INTENT"; readonly command: StructuredCommand }
  | { readonly source: "LOCAL_LLM"; readonly kind: "INTENT_PROPOSAL"; readonly command: StructuredCommand }
  | { readonly source: "LOCAL_LLM"; readonly kind: "ANSWER"; readonly text: string }
  | { readonly source: "NONE"; readonly kind: "NO_RESULT" };
