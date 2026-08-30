import { JarvisError } from "../errors.js";
import type {
  EscalationDecision,
  EscalationInput,
  EscalationReason,
  SelectedCloudContext
} from "./contracts.js";

export class EscalationEngine {
  decide(input: EscalationInput): EscalationDecision {
    validate(input);
    const reason = selectReason(input);
    const allowed = input.mode !== "LOCAL" && !input.deterministicMatched && reason !== null;
    return {
      allowed,
      mode: input.mode,
      reason: allowed ? reason : null,
      requestText: input.text,
      minimumContext: allowed && includesContext(reason)
        ? structuredClone(input.context?.slice(-2) ?? [])
        : []
    };
  }
}

function selectReason(input: EscalationInput): EscalationReason | null {
  if (input.mode === "LOCAL" || input.deterministicMatched) return null;
  if (input.explicitCloudRequest) return "EXPLICIT_USER_REQUEST";
  if (input.localStatus === "UNAVAILABLE") return "LOCAL_MODEL_UNAVAILABLE";
  if (input.localStatus === "LOW_CONFIDENCE") return "LOCAL_LOW_CONFIDENCE";
  if (input.complexReasoning) return "COMPLEX_REASONING";
  if (input.consecutiveLocalFailures >= 2) return "REPEATED_LOCAL_FAILURE";
  return null;
}

function includesContext(reason: EscalationReason | null): boolean {
  return reason === "COMPLEX_REASONING" || reason === "REPEATED_LOCAL_FAILURE" || reason === "EXPLICIT_USER_REQUEST";
}

function validate(input: EscalationInput): void {
  if (
    typeof input !== "object" || input === null ||
    !new Set(["LOCAL", "HYBRID", "MAX"]).has(input.mode) ||
    typeof input.text !== "string" || input.text.length === 0 || input.text.length > 4_096 ||
    typeof input.deterministicMatched !== "boolean" ||
    typeof input.explicitCloudRequest !== "boolean" ||
    typeof input.complexReasoning !== "boolean" ||
    !new Set(["SUFFICIENT", "NO_RESULT", "UNAVAILABLE", "LOW_CONFIDENCE", "FAILED"]).has(input.localStatus) ||
    !Number.isSafeInteger(input.consecutiveLocalFailures) || input.consecutiveLocalFailures < 0 || input.consecutiveLocalFailures > 1_000 ||
    (input.context !== undefined && (!Array.isArray(input.context) || !input.context.every(validContext)))
  ) throw invalidDecision();
}

function validContext(value: SelectedCloudContext): boolean {
  return typeof value === "object" && value !== null && value.source === "SHORT_TERM_CONTEXT" && typeof value.text === "string";
}

function invalidDecision(): JarvisError {
  return new JarvisError("CLOUD_INVALID_RESPONSE", 422, "Escalation input is invalid.");
}
