import type { IntentRouter } from "../intents/contracts.js";
import { JarvisError } from "../errors.js";
import type { LocalLLMProvider } from "../llm/contracts.js";
import type { TranscriptResult } from "../stt/contracts.js";
import { ConversationContextBuilder } from "./context-builder.js";
import type { ConversationSessionStore } from "./contracts.js";
import { DeterministicConversationResolver } from "./resolver.js";

export type ContextAwareRoutingResult =
  | { readonly source: "DETERMINISTIC"; readonly kind: "INTENT"; readonly command: import("../intents/contracts.js").StructuredCommand }
  | { readonly source: "CONTEXT"; readonly kind: "INTENT_PROPOSAL"; readonly command: import("../intents/contracts.js").StructuredCommand }
  | { readonly source: "CONTEXT" | "LOCAL_LLM"; readonly kind: "ANSWER"; readonly text: string }
  | { readonly source: "LOCAL_LLM"; readonly kind: "INTENT_PROPOSAL"; readonly command: import("../intents/contracts.js").StructuredCommand }
  | { readonly source: "NONE"; readonly kind: "NO_RESULT" };

export class ContextAwareIntelligenceRouter {
  constructor(
    private readonly deterministic: IntentRouter,
    private readonly localLLM: LocalLLMProvider,
    private readonly sessions: ConversationSessionStore,
    private readonly contextBuilder = new ConversationContextBuilder(),
    private readonly resolver = new DeterministicConversationResolver()
  ) {}

  async route(
    sessionId: string,
    transcript: TranscriptResult,
    signal?: AbortSignal
  ): Promise<ContextAwareRoutingResult> {
    const fast = this.deterministic.route(transcript);
    if (fast.status === "UNCERTAIN" || transcript.status !== "SUCCESS") {
      return { source: "NONE", kind: "NO_RESULT" };
    }
    const session = await this.sessions.get(sessionId, signal);
    if (session === undefined) {
      throw new JarvisError("CONVERSATION_NOT_FOUND", 404, "Conversation session was not found.");
    }
    if (fast.status === "MATCHED") {
      return { source: "DETERMINISTIC", kind: "INTENT", command: fast.command };
    }
    const contextual = this.resolver.resolve(transcript.text, session);
    if (contextual !== null) return { source: "CONTEXT", ...contextual };
    const prompt = this.contextBuilder.build(
      session,
      transcript.text
    );
    const local = await this.localLLM.interpret(prompt, signal === undefined ? {} : { signal });
    if (local.kind === "ANSWER") return { source: "LOCAL_LLM", kind: "ANSWER", text: local.text };
    if (local.kind === "INTENT_PROPOSAL") return { source: "LOCAL_LLM", kind: "INTENT_PROPOSAL", command: local.command };
    return { source: "NONE", kind: "NO_RESULT" };
  }
}
