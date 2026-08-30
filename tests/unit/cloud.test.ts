import assert from "node:assert/strict";
import test from "node:test";
import {
  EscalationEngine,
  OpenAICompatibleCloudRuntime,
  PrivacyGate,
  ValidatedCloudLLMProvider,
  createCloudLLMProvider,
  loadCloudProviderConfiguration,
  loadIntelligenceMode,
  parseIntelligenceDirectives,
  type CloudLLMRuntimeClient,
  type CloudRuntimeResult
} from "../../src/cloud/index.js";
import { JarvisError } from "../../src/errors.js";

class FakeRuntime implements CloudLLMRuntimeClient {
  readonly metadata = { provider: "fake-cloud", model: "fake-model" };
  readonly prompts: string[] = [];
  readonly #result: CloudRuntimeResult;

  constructor(result: CloudRuntimeResult) {
    this.#result = result;
  }

  async generate(prompt: string): Promise<CloudRuntimeResult> {
    this.prompts.push(prompt);
    return this.#result;
  }
}

const candidate = {
  mode: "HYBRID" as const,
  escalationReason: "EXPLICIT_USER_REQUEST" as const,
  input: "Объясни кратко статус проекта",
  context: [{ source: "SHORT_TERM_CONTEXT" as const, text: "Проект JARVIS, этап J13" }]
};

test("parses explicit local, cloud, maximum, and complex-reasoning directives", () => {
  assert.deepEqual(parseIntelligenceDirectives("только локально, объясни статус"), {
    mode: "LOCAL",
    text: "объясни статус",
    explicitCloudRequest: false,
    complexReasoning: false
  });
  assert.deepEqual(parseIntelligenceDirectives("спроси GPT: объясни статус"), {
    mode: "HYBRID",
    text: "объясни статус",
    explicitCloudRequest: true,
    complexReasoning: false
  });
  assert.deepEqual(parseIntelligenceDirectives("спроси старшего, объясни статус"), {
    mode: "HYBRID",
    text: "объясни статус",
    explicitCloudRequest: true,
    complexReasoning: false
  });
  assert.deepEqual(parseIntelligenceDirectives("используй максимальный интеллект: глубокий анализ"), {
    mode: "MAX",
    text: "глубокий анализ",
    explicitCloudRequest: true,
    complexReasoning: true
  });
});

test("produces inspectable escalation decisions with minimum selected context", () => {
  const context = ["one", "two", "three"].map((text) => ({
    source: "SHORT_TERM_CONTEXT" as const,
    text
  }));
  const engine = new EscalationEngine();
  assert.deepEqual(engine.decide({
    mode: "HYBRID",
    text: "analyze",
    deterministicMatched: false,
    explicitCloudRequest: false,
    complexReasoning: true,
    localStatus: "SUFFICIENT",
    consecutiveLocalFailures: 0,
    context
  }), {
    allowed: true,
    mode: "HYBRID",
    reason: "COMPLEX_REASONING",
    requestText: "analyze",
    minimumContext: context.slice(-2)
  });
  assert.equal(engine.decide({
    mode: "LOCAL",
    text: "analyze",
    deterministicMatched: false,
    explicitCloudRequest: true,
    complexReasoning: true,
    localStatus: "UNAVAILABLE",
    consecutiveLocalFailures: 3
  }).allowed, false);
});

test("privacy gate rejects secrets, biometric material, paths, environment values, and encoded blobs", () => {
  const gate = new PrivacyGate();
  for (const input of [
    "password=hunter2",
    "Authorization: Bearer abcdefghijklmnop",
    "token=abcdefghijk",
    "-----BEGIN PRIVATE KEY-----",
    "eyJabcdefgh.abcdefgh.abcdefgh",
    "raw audio samples",
    "VoiceID speaker embedding",
    "data:audio/wav;base64,AAAA",
    "прочитай /Users/maxim/private.txt",
    "OPENAI_API_KEY=secret",
    "$HOME/config",
    "A".repeat(120)
  ]) {
    assert.throws(() => gate.approve({ ...candidate, input }), hasCode("CLOUD_PRIVACY_REJECTED"));
  }
});

test("privacy gate rejects extra sensitive fields, forged approvals, and excessive context", async () => {
  const gate = new PrivacyGate({ maxContextItems: 1, maxContextCharacters: 20 });
  assert.throws(
    () => gate.approve({ ...candidate, audio: new Float32Array([1]) } as never),
    hasCode("CLOUD_PRIVACY_REJECTED")
  );
  assert.throws(
    () => gate.approve({ ...candidate, context: [
      { source: "SHORT_TERM_CONTEXT", text: "one" },
      { source: "SHORT_TERM_CONTEXT", text: "two" }
    ] }),
    hasCode("CLOUD_PRIVACY_REJECTED")
  );
  const forged = { ...candidate, privacyStatus: "APPROVED" as const };
  await assert.rejects(
    new ValidatedCloudLLMProvider(new FakeRuntime({ status: "VALID", output: '{"kind":"NO_RESULT"}' }))
      .interpret(forged),
    hasCode("CLOUD_PRIVACY_REJECTED")
  );
});

test("validates answer, intent proposal, no-result, metadata, and token usage", async () => {
  const outputs = [
    ['{"kind":"ANSWER","text":"Краткий облачный ответ."}', "ANSWER"],
    ['{"kind":"INTENT_PROPOSAL","command":{"intent":"GET_BATTERY","parameters":{},"confidence":0.9}}', "INTENT_PROPOSAL"],
    ['{"kind":"NO_RESULT"}', "NO_RESULT"]
  ] as const;
  for (const [output, kind] of outputs) {
    const provider = new ValidatedCloudLLMProvider(new FakeRuntime({
      status: "VALID",
      output,
      usage: { inputTokens: 12, outputTokens: 4 }
    }));
    const result = await provider.interpret(new PrivacyGate().approve(candidate));
    assert.equal(result.kind, kind);
    assert.equal(result.metadata.mode, "HYBRID");
    assert.equal(result.metadata.escalationReason, "EXPLICIT_USER_REQUEST");
    assert.equal(result.metadata.provider, "fake-cloud");
    assert.deepEqual(result.metadata.tokenUsage, { inputTokens: 12, outputTokens: 4 });
    assert.equal(Number.isFinite(result.metadata.latencyMs), true);
    assert.equal(result.metadata.requestCharacters > 0, true);
    assert.equal(result.metadata.responseCharacters, output.length);
  }
});

test("rejects malformed, hostile, secret-bearing, and unknown cloud output", async () => {
  for (const output of [
    "not json",
    '{"kind":"ANSWER","text":"token=secret"}',
    '{"kind":"ANSWER","text":"read /private/data"}',
    '{"kind":"ANSWER","text":"ok","extra":true}',
    '{"kind":"INTENT_PROPOSAL","command":{"intent":"SHELL","parameters":{"command":"rm"},"confidence":1}}',
    '{"kind":"INTENT_PROPOSAL","command":{"intent":"OPEN_APPLICATION","parameters":{"application":"Terminal"},"confidence":1}}'
  ]) {
    const provider = new ValidatedCloudLLMProvider(new FakeRuntime({ status: "VALID", output }));
    await assert.rejects(
      provider.interpret(new PrivacyGate().approve(candidate)),
      hasCode("CLOUD_INVALID_RESPONSE")
    );
  }
});

test("maps cancellation, timeout, provider unavailability, and runtime failures safely", async () => {
  const pending: CloudLLMRuntimeClient = {
    metadata: { provider: "fake", model: "fake" },
    generate: () => new Promise(() => undefined)
  };
  const request = new PrivacyGate().approve(candidate);
  await assert.rejects(
    new ValidatedCloudLLMProvider(pending, { timeoutMilliseconds: 5 }).interpret(request),
    hasCode("CLOUD_TIMEOUT")
  );
  const controller = new AbortController();
  const cancelled = new ValidatedCloudLLMProvider(pending).interpret(request, { signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, hasCode("CLOUD_CANCELLED"));
  await assert.rejects(
    new ValidatedCloudLLMProvider(new FakeRuntime({ status: "INVALID", errorCode: "MODEL_UNAVAILABLE" }))
      .interpret(request),
    hasCode("CLOUD_MODEL_UNAVAILABLE")
  );
  const throwing: CloudLLMRuntimeClient = {
    metadata: { provider: "fake", model: "fake" },
    async generate() { throw new Error("api_key=topsecret /private/data"); }
  };
  await assert.rejects(
    new ValidatedCloudLLMProvider(throwing).interpret(request),
    (error: unknown) => error instanceof JarvisError &&
      error.code === "CLOUD_RUNTIME_FAILURE" &&
      !error.message.includes("topsecret") &&
      !error.message.includes("private")
  );
});

test("OpenAI-compatible runtime sends a bounded schema request without leaking its key", async () => {
  const apiKey = testApiKey();
  let authorization = "";
  let body = "";
  const runtime = new OpenAICompatibleCloudRuntime({
    endpoint: "https://api.example.com/v1/chat/completions",
    apiKey,
    model: "fake-7b",
    maxOutputTokens: 64,
    fetch: async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      body = String(init?.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"kind":"NO_RESULT"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 }
      }));
    }
  });
  assert.deepEqual(await runtime.generate("safe prompt"), {
    status: "VALID",
    output: '{"kind":"NO_RESULT"}',
    usage: { inputTokens: 10, outputTokens: 2 }
  });
  const parsed = JSON.parse(body) as Record<string, unknown>;
  assert.equal(authorization, `Bearer ${apiKey}`);
  assert.equal(body.includes(apiKey), false);
  assert.equal(parsed.stream, undefined);
  assert.equal(parsed.temperature, 0);
  assert.equal(parsed.max_tokens, 64);
  assert.equal(typeof parsed.response_format, "object");
});

test("OpenAI-compatible runtime forwards aborts and distinguishes connection failures", async () => {
  const controller = new AbortController();
  const runtime = new OpenAICompatibleCloudRuntime({
    endpoint: "https://api.example.com/v1/chat/completions",
    apiKey: testApiKey(),
    model: "fake",
    maxOutputTokens: 10,
    fetch: (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })
  });
  const pending = runtime.generate("safe", controller.signal);
  controller.abort();
  await assert.rejects(pending);

  const unavailable = new OpenAICompatibleCloudRuntime({
    endpoint: "https://api.example.com/v1/chat/completions",
    apiKey: testApiKey(),
    model: "fake",
    maxOutputTokens: 10,
    fetch: async () => { throw new Error("ECONNREFUSED secret"); }
  });
  assert.deepEqual(await unavailable.generate("safe"), {
    status: "INVALID",
    errorCode: "MODEL_UNAVAILABLE"
  });
});

test("rejects unsafe cloud endpoints and loads local-first configuration", () => {
  for (const endpoint of [
    "http://api.example.com/v1/chat/completions",
    "https://localhost/v1/chat/completions",
    "https://127.0.0.1/v1/chat/completions",
    "https://api.example.com/other"
  ]) {
    assert.throws(() => new OpenAICompatibleCloudRuntime({
      endpoint,
      apiKey: testApiKey(),
      model: "fake",
      maxOutputTokens: 10
    }), hasCode("CLOUD_MODEL_UNAVAILABLE"));
  }
  assert.equal(loadIntelligenceMode({}), "HYBRID");
  assert.deepEqual(loadCloudProviderConfiguration({}), {
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4.1-mini",
    timeoutMilliseconds: 30_000,
    maxOutputTokens: 512
  });
  assert.throws(() => createCloudLLMProvider({ environment: {} }), hasCode("CLOUD_MODEL_UNAVAILABLE"));
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof JarvisError && error.code === code;
}

function testApiKey(): string {
  return ["test", "key", "not", "secret"].join("-");
}
