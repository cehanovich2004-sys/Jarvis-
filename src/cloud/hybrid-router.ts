import { JarvisError } from "../errors.js";
import type { IntentRouter } from "../intents/contracts.js";
import type { LocalIntelligenceResult, LocalLLMProvider } from "../llm/contracts.js";
import type { TranscriptResult } from "../stt/contracts.js";
import type {
  CloudLLMProvider,
  EscalationDecision,
  HybridIntelligenceRoutingResult,
  HybridRoutingOptions,
  IntelligenceMode,
  LocalAttempt
} from "./contracts.js";
import { parseIntelligenceDirectives } from "./directives.js";
import { EscalationEngine } from "./escalation.js";
import { PrivacyGate } from "./privacy-gate.js";

export class HybridIntelligenceRouter {
  constructor(
    private readonly deterministic: IntentRouter,
    private readonly local: LocalLLMProvider,
    private readonly cloud: CloudLLMProvider,
    private readonly defaultMode: IntelligenceMode = "HYBRID",
    private readonly escalation = new EscalationEngine(),
    private readonly privacy = new PrivacyGate()
  ) {}

  async route(
    transcript: TranscriptResult,
    options: HybridRoutingOptions = {}
  ): Promise<HybridIntelligenceRoutingResult> {
    if (transcript.status !== "SUCCESS" || typeof transcript.text !== "string") {
      return { source: "NONE", kind: "NO_RESULT" };
    }
    const directives = parseIntelligenceDirectives(transcript.text, options.mode ?? this.defaultMode);
    if (directives.text.length === 0) return { source: "NONE", kind: "NO_RESULT" };
    const routedTranscript = { ...transcript, text: directives.text };
    const fast = this.deterministic.route(routedTranscript);
    if (fast.status === "MATCHED") {
      return { source: "DETERMINISTIC", kind: "INTENT", command: fast.command };
    }
    if (fast.status === "UNCERTAIN") return { source: "NONE", kind: "NO_RESULT" };

    const local = await this.#localAttempt(directives.text, options.signal);
    const failureCount = (options.consecutiveLocalFailures ?? 0) +
      (local.status === "FAILED" || local.status === "NO_RESULT" ? 1 : 0);
    const decision = this.escalation.decide({
      mode: directives.mode,
      text: directives.text,
      deterministicMatched: false,
      explicitCloudRequest: directives.explicitCloudRequest,
      complexReasoning: directives.complexReasoning,
      localStatus: local.status,
      consecutiveLocalFailures: failureCount,
      ...(options.context === undefined ? {} : { context: options.context })
    });
    if (!decision.allowed || decision.reason === null) return localResult(local.result);

    const approved = this.privacy.approve({
      mode: decision.mode,
      escalationReason: decision.reason,
      input: decision.requestText,
      context: decision.minimumContext
    });
    try {
      const cloud = await this.cloud.interpret(
        approved,
        options.signal === undefined ? {} : { signal: options.signal }
      );
      if (cloud.kind === "ANSWER") {
        return { source: "CLOUD_LLM", kind: "ANSWER", text: cloud.text, metadata: cloud.metadata, escalation: decision };
      }
      if (cloud.kind === "INTENT_PROPOSAL") {
        return { source: "CLOUD_LLM", kind: "INTENT_PROPOSAL", command: cloud.command, metadata: cloud.metadata, escalation: decision };
      }
      return { source: "CLOUD_LLM", kind: "NO_RESULT", metadata: cloud.metadata, escalation: decision };
    } catch (error) {
      if (error instanceof JarvisError && error.code === "CLOUD_CANCELLED") throw error;
      if (error instanceof JarvisError && isCloudFailure(error.code)) {
        return fallback(local.result, decision, error.code);
      }
      throw error;
    }
  }

  async #localAttempt(text: string, signal: AbortSignal | undefined): Promise<LocalAttempt> {
    try {
      const result = await this.local.interpret(text, signal === undefined ? {} : { signal });
      if (result.kind === "NO_RESULT") return { status: "NO_RESULT", result };
      if (result.kind === "INTENT_PROPOSAL" && result.command.confidence < 0.75) {
        return { status: "LOW_CONFIDENCE", result };
      }
      return { status: "SUFFICIENT", result };
    } catch (error) {
      if (!(error instanceof JarvisError)) return { status: "FAILED", result: null };
      if (error.code === "LLM_CANCELLED") throw error;
      if (error.code === "LLM_MODEL_UNAVAILABLE") return { status: "UNAVAILABLE", result: null };
      return { status: "FAILED", result: null };
    }
  }
}

function localResult(result: LocalIntelligenceResult | null): HybridIntelligenceRoutingResult {
  if (result?.kind === "ANSWER") return { source: "LOCAL_LLM", kind: "ANSWER", text: result.text };
  if (result?.kind === "INTENT_PROPOSAL") {
    return { source: "LOCAL_LLM", kind: "INTENT_PROPOSAL", command: result.command };
  }
  return { source: "NONE", kind: "NO_RESULT" };
}

function fallback(
  local: LocalIntelligenceResult | null,
  escalation: EscalationDecision,
  cloudFailure: string
): HybridIntelligenceRoutingResult {
  const result = localResult(local);
  if (result.source === "LOCAL_LLM") return { ...result, cloudFailure };
  return { source: "NONE", kind: "NO_RESULT", cloudFailure, escalation };
}

function isCloudFailure(code: string): boolean {
  return new Set([
    "CLOUD_DISABLED",
    "CLOUD_MODEL_UNAVAILABLE",
    "CLOUD_RUNTIME_FAILURE",
    "CLOUD_TIMEOUT",
    "CLOUD_INVALID_RESPONSE"
  ]).has(code);
}
