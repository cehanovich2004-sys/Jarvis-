import assert from "node:assert/strict";
import test from "node:test";
import {
  HybridIntelligenceRouter,
  type CloudIntelligenceResult,
  type CloudLLMProvider,
  type PrivacyApprovedCloudRequest
} from "../../src/cloud/index.js";
import { JarvisError } from "../../src/errors.js";
import { DeterministicIntentRouter } from "../../src/intents/index.js";
import type { LocalIntelligenceResult, LocalLLMProvider } from "../../src/llm/index.js";
import type { TranscriptResult } from "../../src/stt/contracts.js";

class FakeLocal implements LocalLLMProvider {
  calls = 0;
  readonly #result: LocalIntelligenceResult | JarvisError;

  constructor(result: LocalIntelligenceResult | JarvisError) {
    this.#result = result;
  }

  async interpret(): Promise<LocalIntelligenceResult> {
    this.calls += 1;
    if (this.#result instanceof JarvisError) throw this.#result;
    return this.#result;
  }
}

class FakeCloud implements CloudLLMProvider {
  calls = 0;
  requests: PrivacyApprovedCloudRequest[] = [];
  readonly #result: CloudIntelligenceResult | JarvisError;

  constructor(result: CloudIntelligenceResult | JarvisError) {
    this.#result = result;
  }

  async interpret(request: PrivacyApprovedCloudRequest): Promise<CloudIntelligenceResult> {
    this.calls += 1;
    this.requests.push(request);
    if (this.#result instanceof JarvisError) throw this.#result;
    return this.#result;
  }
}

const localMetadata = { backend: "fake-local", model: "fake-7b" };
const cloudMetadata = {
  mode: "HYBRID" as const,
  escalationReason: "EXPLICIT_USER_REQUEST" as const,
  provider: "fake-cloud",
  model: "fake-model",
  latencyMs: 1,
  requestCharacters: 20,
  responseCharacters: 20
};

function transcript(text: string): TranscriptResult {
  return {
    status: "SUCCESS",
    text,
    durationSeconds: 1,
    transcriptionLatencyMs: 1,
    backendMetadata: { backend: "fake", model: "fake" }
  };
}

function router(local: FakeLocal, cloud: FakeCloud, mode: "LOCAL" | "HYBRID" | "MAX" = "HYBRID") {
  return new HybridIntelligenceRouter(new DeterministicIntentRouter(), local, cloud, mode);
}

test("known deterministic intents never call local or cloud in any intelligence mode", async () => {
  for (const mode of ["LOCAL", "HYBRID", "MAX"] as const) {
    for (const text of ["Открой Safari", "Какой заряд батареи?"]) {
      const local = new FakeLocal({ kind: "NO_RESULT", latencyMs: 1, metadata: localMetadata });
      const cloud = new FakeCloud({ kind: "NO_RESULT", metadata: cloudMetadata });
      const result = await router(local, cloud, mode).route(transcript(text));
      assert.equal(result.source, "DETERMINISTIC");
      assert.equal(local.calls, 0);
      assert.equal(cloud.calls, 0);
    }
  }
});

test("an explicit cloud hint cannot divert a known deterministic command", async () => {
  const local = new FakeLocal({ kind: "NO_RESULT", latencyMs: 1, metadata: localMetadata });
  const cloud = new FakeCloud({ kind: "NO_RESULT", metadata: cloudMetadata });
  const result = await router(local, cloud).route(transcript("спроси GPT, открой Safari"));
  assert.equal(result.source, "DETERMINISTIC");
  assert.equal(local.calls, 0);
  assert.equal(cloud.calls, 0);
});

test("LOCAL mode and an explicit local-only hint make cloud calls impossible", async () => {
  for (const [mode, text] of [
    ["LOCAL", "объясни архитектуру"],
    ["HYBRID", "только локально, объясни архитектуру"]
  ] as const) {
    const local = new FakeLocal({ kind: "NO_RESULT", latencyMs: 1, metadata: localMetadata });
    const cloud = new FakeCloud({ kind: "NO_RESULT", metadata: cloudMetadata });
    const result = await router(local, cloud, mode).route(transcript(text), { consecutiveLocalFailures: 5 });
    assert.equal(result.source, "NONE");
    assert.equal(local.calls, 1);
    assert.equal(cloud.calls, 0);
  }
});

test("HYBRID remains local-first when the local result is sufficient", async () => {
  const local = new FakeLocal({
    kind: "ANSWER",
    text: "Локальный ответ.",
    latencyMs: 1,
    metadata: localMetadata
  });
  const cloud = new FakeCloud({ kind: "NO_RESULT", metadata: cloudMetadata });
  assert.deepEqual(await router(local, cloud).route(transcript("объясни архитектуру")), {
    source: "LOCAL_LLM",
    kind: "ANSWER",
    text: "Локальный ответ."
  });
  assert.equal(cloud.calls, 0);
});

test("explicit GPT request escalates with bounded privacy-approved context", async () => {
  const local = new FakeLocal({
    kind: "ANSWER",
    text: "Локальный черновик.",
    latencyMs: 1,
    metadata: localMetadata
  });
  const cloud = new FakeCloud({ kind: "ANSWER", text: "Облачный ответ.", metadata: cloudMetadata });
  const context = ["old", "recent", "latest"].map((text) => ({
    source: "SHORT_TERM_CONTEXT" as const,
    text
  }));
  const result = await router(local, cloud).route(transcript("спроси GPT: объясни архитектуру"), { context });
  assert.equal(result.source, "CLOUD_LLM");
  assert.equal(result.escalation.reason, "EXPLICIT_USER_REQUEST");
  assert.equal(cloud.calls, 1);
  assert.equal(cloud.requests[0]?.privacyStatus, "APPROVED");
  assert.deepEqual(cloud.requests[0]?.context, context.slice(-2));
});

test("HYBRID escalates only for typed unavailable, low-confidence, complex, or repeated reasons", async () => {
  const scenarios = [
    {
      local: new JarvisError("LLM_MODEL_UNAVAILABLE", 503, "unavailable"),
      text: "объясни архитектуру",
      options: {},
      reason: "LOCAL_MODEL_UNAVAILABLE"
    },
    {
      local: {
        kind: "INTENT_PROPOSAL" as const,
        command: { intent: "GET_BATTERY" as const, parameters: {}, confidence: 0.7 },
        latencyMs: 1,
        metadata: localMetadata
      },
      text: "как аккумулятор",
      options: {},
      reason: "LOCAL_LOW_CONFIDENCE"
    },
    {
      local: { kind: "ANSWER" as const, text: "draft", latencyMs: 1, metadata: localMetadata },
      text: "сделай глубокий анализ архитектуры",
      options: {},
      reason: "COMPLEX_REASONING"
    },
    {
      local: { kind: "NO_RESULT" as const, latencyMs: 1, metadata: localMetadata },
      text: "объясни архитектуру",
      options: { consecutiveLocalFailures: 1 },
      reason: "REPEATED_LOCAL_FAILURE"
    }
  ] as const;
  for (const scenario of scenarios) {
    const local = new FakeLocal(scenario.local);
    const cloud = new FakeCloud({ kind: "NO_RESULT", metadata: cloudMetadata });
    const result = await router(local, cloud).route(transcript(scenario.text), scenario.options);
    assert.equal(result.source, "CLOUD_LLM");
    assert.equal(result.escalation.reason, scenario.reason);
    assert.equal(cloud.calls, 1);
  }
});

test("cloud failure returns a safe local fallback instead of crashing HYBRID mode", async () => {
  const local = new FakeLocal({
    kind: "ANSWER",
    text: "Безопасный локальный ответ.",
    latencyMs: 1,
    metadata: localMetadata
  });
  const cloud = new FakeCloud(new JarvisError(
    "CLOUD_MODEL_UNAVAILABLE",
    503,
    "Cloud model is unavailable."
  ));
  assert.deepEqual(await router(local, cloud).route(transcript("спроси GPT: объясни архитектуру")), {
    source: "LOCAL_LLM",
    kind: "ANSWER",
    text: "Безопасный локальный ответ.",
    cloudFailure: "CLOUD_MODEL_UNAVAILABLE"
  });
});

test("cloud intent output remains an unexecuted proposal", async () => {
  const local = new FakeLocal({ kind: "NO_RESULT", latencyMs: 1, metadata: localMetadata });
  const command = { intent: "GET_BATTERY" as const, parameters: {}, confidence: 0.9 };
  const cloud = new FakeCloud({ kind: "INTENT_PROPOSAL", command, metadata: cloudMetadata });
  const result = await router(local, cloud).route(transcript("спроси GPT: проверь питание"));
  assert.deepEqual(result, {
    source: "CLOUD_LLM",
    kind: "INTENT_PROPOSAL",
    command,
    metadata: cloudMetadata,
    escalation: {
      allowed: true,
      mode: "HYBRID",
      reason: "EXPLICIT_USER_REQUEST",
      requestText: "проверь питание",
      minimumContext: []
    }
  });
});

test("privacy rejection and cancellation fail closed across the hybrid boundary", async () => {
  const local = new FakeLocal({ kind: "NO_RESULT", latencyMs: 1, metadata: localMetadata });
  const cloud = new FakeCloud(new JarvisError("CLOUD_CANCELLED", 499, "cancelled"));
  await assert.rejects(
    router(local, cloud).route(transcript("спроси GPT: explain architecture")),
    hasCode("CLOUD_CANCELLED")
  );

  const privateCloud = new FakeCloud({ kind: "NO_RESULT", metadata: cloudMetadata });
  await assert.rejects(
    router(new FakeLocal({ kind: "NO_RESULT", latencyMs: 1, metadata: localMetadata }), privateCloud)
      .route(transcript("спроси GPT: token=private-secret")),
    hasCode("CLOUD_PRIVACY_REJECTED")
  );
  assert.equal(privateCloud.calls, 0);
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof JarvisError && error.code === code;
}
