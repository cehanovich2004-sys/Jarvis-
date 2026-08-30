import type { IntentRouter } from "../intents/contracts.js";
import type { TranscriptResult } from "../stt/contracts.js";
import type { IntelligenceRoutingResult, LocalLLMProvider } from "./contracts.js";

export class DeterministicFirstIntelligenceRouter {
  constructor(
    private readonly deterministic: IntentRouter,
    private readonly localLLM: LocalLLMProvider
  ) {}

  async route(transcript: TranscriptResult, signal?: AbortSignal): Promise<IntelligenceRoutingResult> {
    const fast = this.deterministic.route(transcript);
    if (fast.status === "MATCHED") {
      return { source: "DETERMINISTIC", kind: "INTENT", command: fast.command };
    }
    if (fast.status === "UNCERTAIN" || transcript.status !== "SUCCESS") {
      return { source: "NONE", kind: "NO_RESULT" };
    }
    const local = await this.localLLM.interpret(
      transcript.text,
      signal === undefined ? {} : { signal }
    );
    if (local.kind === "ANSWER") return { source: "LOCAL_LLM", kind: "ANSWER", text: local.text };
    if (local.kind === "INTENT_PROPOSAL") {
      return { source: "LOCAL_LLM", kind: "INTENT_PROPOSAL", command: local.command };
    }
    return { source: "NONE", kind: "NO_RESULT" };
  }
}
