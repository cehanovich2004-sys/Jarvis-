import assert from "node:assert/strict";
import test from "node:test";
import {
  ContextAwareIntelligenceRouter,
  InMemoryConversationSessionStore
} from "../../src/conversation/index.js";
import { DeterministicIntentRouter } from "../../src/intents/index.js";
import { JarvisError } from "../../src/errors.js";
import type { LocalIntelligenceResult, LocalLLMProvider } from "../../src/llm/contracts.js";
import type { TranscriptResult } from "../../src/stt/contracts.js";

class CapturingLLM implements LocalLLMProvider {
  calls = 0;
  input = "";
  constructor(private readonly result: LocalIntelligenceResult) {}
  async interpret(input: string): Promise<LocalIntelligenceResult> {
    this.calls += 1;
    this.input = input;
    return this.result;
  }
}

const metadata = { backend: "fake", model: "fake-7b" };
function transcript(text: string, status: TranscriptResult["status"] = "SUCCESS"): TranscriptResult {
  return { status, text, durationSeconds: 1, transcriptionLatencyMs: 1, backendMetadata: { backend: "fake", model: "fake" } };
}

test("active session resolves follow-up application and battery turns without model execution", async () => {
  const sessions = new InMemoryConversationSessionStore({ ttlMilliseconds: 10_000, maxTurns: 8, maxCharacters: 2_000 });
  await sessions.create("session-followup");
  await sessions.append("session-followup", {
    userText: "Открой Safari", assistantText: "Safari открыт.",
    outcome: { kind: "INTENT", command: { intent: "OPEN_APPLICATION", parameters: { application: "Safari" }, confidence: 1 } },
    tool: { intent: "OPEN_APPLICATION", status: "SUCCESS", application: "Safari" },
    metadata: { source: "DETERMINISTIC" }
  });
  await sessions.append("session-followup", {
    userText: "Какой заряд?", assistantText: "Заряд батареи 25 процентов. Питание от сети.",
    outcome: { kind: "INTENT", command: { intent: "GET_BATTERY", parameters: {}, confidence: 1 } },
    tool: { intent: "GET_BATTERY", status: "SUCCESS", percentage: 25, powerSource: "AC" },
    metadata: { source: "DETERMINISTIC" }
  });
  const llm = new CapturingLLM({ kind: "NO_RESULT", latencyMs: 1, metadata });
  const router = new ContextAwareIntelligenceRouter(new DeterministicIntentRouter(), llm, sessions);
  assert.equal((await router.route("session-followup", transcript("Теперь Finder"))).kind, "INTENT_PROPOSAL");
  assert.deepEqual(await router.route("session-followup", transcript("Подключён к сети?")), {
    source: "CONTEXT", kind: "ANSWER", text: "Да, питание от сети."
  });
  assert.equal(llm.calls, 0);
});

test("unknown follow-up sends only bounded structured context to local intelligence", async () => {
  const sessions = new InMemoryConversationSessionStore({ ttlMilliseconds: 10_000, maxTurns: 4, maxCharacters: 1_000 });
  await sessions.create("session-local");
  await sessions.append("session-local", {
    userText: "Какой заряд?", assistantText: "Батарея 50 процентов.",
    outcome: { kind: "INTENT", command: { intent: "GET_BATTERY", parameters: {}, confidence: 1 } },
    tool: { intent: "GET_BATTERY", status: "SUCCESS", percentage: 50, powerSource: "BATTERY" },
    metadata: { source: "DETERMINISTIC" }
  });
  const llm = new CapturingLLM({ kind: "ANSWER", text: "Уточните вопрос.", latencyMs: 1, metadata });
  const result = await new ContextAwareIntelligenceRouter(
    new DeterministicIntentRouter(), llm, sessions
  ).route("session-local", transcript("А что это значит?"));
  assert.deepEqual(result, { source: "LOCAL_LLM", kind: "ANSWER", text: "Уточните вопрос." });
  assert.match(llm.input, /battery=50; power=BATTERY/u);
  assert.equal(llm.input.includes("samples"), false);
  assert.equal(llm.input.includes("embedding"), false);
});

test("known, uncertain, and empty current turns do not use context to bypass routing gates", async () => {
  const sessions = new InMemoryConversationSessionStore({ ttlMilliseconds: 10_000, maxTurns: 4, maxCharacters: 1_000 });
  await sessions.create("session-gates");
  const llm = new CapturingLLM({ kind: "NO_RESULT", latencyMs: 1, metadata });
  const router = new ContextAwareIntelligenceRouter(new DeterministicIntentRouter(), llm, sessions);
  assert.equal((await router.route("session-gates", transcript("Открой Safari"))).source, "DETERMINISTIC");
  assert.deepEqual(await router.route("session-gates", transcript("Теперь Finder", "UNCERTAIN")), { source: "NONE", kind: "NO_RESULT" });
  assert.deepEqual(await router.route("session-gates", transcript("", "EMPTY")), { source: "NONE", kind: "NO_RESULT" });
  assert.equal(llm.calls, 0);
  await assert.rejects(
    router.route("missing-session", transcript("Открой Safari")),
    (error: unknown) => error instanceof JarvisError && error.code === "CONVERSATION_NOT_FOUND"
  );
});
