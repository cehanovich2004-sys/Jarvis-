import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicIntentRouter } from "../../src/intents/index.js";
import {
  DeterministicFirstIntelligenceRouter,
  type LocalLLMProvider,
  type LocalIntelligenceResult
} from "../../src/llm/index.js";
import type { TranscriptResult } from "../../src/stt/contracts.js";

class FakeProvider implements LocalLLMProvider {
  calls = 0;
  readonly #result: LocalIntelligenceResult;
  constructor(result: LocalIntelligenceResult) { this.#result = result; }
  async interpret(): Promise<LocalIntelligenceResult> { this.calls += 1; return this.#result; }
}

const metadata = { backend: "fake", model: "fake-7b" };
function transcript(text: string): TranscriptResult {
  return { status: "SUCCESS", text, durationSeconds: 1, transcriptionLatencyMs: 1, backendMetadata: { backend: "fake", model: "fake" } };
}

test("deterministic known intent bypasses the local model", async () => {
  const provider = new FakeProvider({ kind: "NO_RESULT", latencyMs: 1, metadata });
  const result = await new DeterministicFirstIntelligenceRouter(
    new DeterministicIntentRouter(), provider
  ).route(transcript("Открой Safari"));
  assert.equal(result.source, "DETERMINISTIC");
  assert.equal(result.kind, "INTENT");
  assert.equal(provider.calls, 0);
});

test("NO_MATCH may produce a conversation answer or a validated proposal but never executes it", async () => {
  const answer = new FakeProvider({ kind: "ANSWER", text: "Локальный ответ.", latencyMs: 1, metadata });
  assert.deepEqual(
    await new DeterministicFirstIntelligenceRouter(new DeterministicIntentRouter(), answer).route(transcript("Объясни статус")),
    { source: "LOCAL_LLM", kind: "ANSWER", text: "Локальный ответ." }
  );
  const proposal = new FakeProvider({
    kind: "INTENT_PROPOSAL",
    command: { intent: "GET_BATTERY", parameters: {}, confidence: 0.8 },
    latencyMs: 1,
    metadata
  });
  assert.deepEqual(
    await new DeterministicFirstIntelligenceRouter(new DeterministicIntentRouter(), proposal).route(transcript("Как там аккумулятор?")),
    { source: "LOCAL_LLM", kind: "INTENT_PROPOSAL", command: { intent: "GET_BATTERY", parameters: {}, confidence: 0.8 } }
  );
});
