import type { StructuredCommand } from "../intents/contracts.js";
import type { LocalIntelligenceResult } from "../llm/contracts.js";

export type IntelligenceMode = "LOCAL" | "HYBRID" | "MAX";
export type EscalationReason =
  | "LOCAL_MODEL_UNAVAILABLE"
  | "LOCAL_LOW_CONFIDENCE"
  | "COMPLEX_REASONING"
  | "REPEATED_LOCAL_FAILURE"
  | "EXPLICIT_USER_REQUEST";

export interface IntelligenceDirectives {
  readonly mode: IntelligenceMode;
  readonly text: string;
  readonly explicitCloudRequest: boolean;
  readonly complexReasoning: boolean;
}

export interface SelectedCloudContext {
  readonly source: "SHORT_TERM_CONTEXT";
  readonly text: string;
}

export type LocalAttemptStatus =
  | "SUFFICIENT"
  | "NO_RESULT"
  | "UNAVAILABLE"
  | "LOW_CONFIDENCE"
  | "FAILED";

export interface EscalationInput {
  readonly mode: IntelligenceMode;
  readonly text: string;
  readonly deterministicMatched: boolean;
  readonly explicitCloudRequest: boolean;
  readonly complexReasoning: boolean;
  readonly localStatus: LocalAttemptStatus;
  readonly consecutiveLocalFailures: number;
  readonly context?: readonly SelectedCloudContext[];
}

export interface EscalationDecision {
  readonly allowed: boolean;
  readonly mode: IntelligenceMode;
  readonly reason: EscalationReason | null;
  readonly requestText: string;
  readonly minimumContext: readonly SelectedCloudContext[];
}

export interface CloudRequestCandidate {
  readonly mode: IntelligenceMode;
  readonly escalationReason: EscalationReason;
  readonly input: string;
  readonly context: readonly SelectedCloudContext[];
}

export interface PrivacyApprovedCloudRequest extends CloudRequestCandidate {
  readonly privacyStatus: "APPROVED";
}

export interface CloudTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface CloudResultMetadata {
  readonly mode: IntelligenceMode;
  readonly escalationReason: EscalationReason;
  readonly provider: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly requestCharacters: number;
  readonly responseCharacters: number;
  readonly tokenUsage?: CloudTokenUsage;
}

export type CloudIntelligenceResult =
  | { readonly kind: "ANSWER"; readonly text: string; readonly metadata: CloudResultMetadata }
  | { readonly kind: "INTENT_PROPOSAL"; readonly command: StructuredCommand; readonly metadata: CloudResultMetadata }
  | { readonly kind: "NO_RESULT"; readonly metadata: CloudResultMetadata };

export interface CloudLLMOptions {
  readonly signal?: AbortSignal;
}

export interface CloudLLMProvider {
  interpret(
    request: PrivacyApprovedCloudRequest,
    options?: CloudLLMOptions
  ): Promise<CloudIntelligenceResult>;
}

export interface HybridRoutingOptions {
  readonly mode?: IntelligenceMode;
  readonly signal?: AbortSignal;
  readonly consecutiveLocalFailures?: number;
  readonly context?: readonly SelectedCloudContext[];
}

export type HybridIntelligenceRoutingResult =
  | { readonly source: "DETERMINISTIC"; readonly kind: "INTENT"; readonly command: StructuredCommand }
  | { readonly source: "LOCAL_LLM"; readonly kind: "ANSWER"; readonly text: string; readonly cloudFailure?: string }
  | { readonly source: "LOCAL_LLM"; readonly kind: "INTENT_PROPOSAL"; readonly command: StructuredCommand; readonly cloudFailure?: string }
  | { readonly source: "CLOUD_LLM"; readonly kind: "ANSWER"; readonly text: string; readonly metadata: CloudResultMetadata; readonly escalation: EscalationDecision }
  | { readonly source: "CLOUD_LLM"; readonly kind: "INTENT_PROPOSAL"; readonly command: StructuredCommand; readonly metadata: CloudResultMetadata; readonly escalation: EscalationDecision }
  | { readonly source: "CLOUD_LLM"; readonly kind: "NO_RESULT"; readonly metadata: CloudResultMetadata; readonly escalation: EscalationDecision }
  | { readonly source: "NONE"; readonly kind: "NO_RESULT"; readonly cloudFailure?: string; readonly escalation?: EscalationDecision };

export interface LocalAttempt {
  readonly status: LocalAttemptStatus;
  readonly result: LocalIntelligenceResult | null;
}
