import assert from "node:assert/strict";
import test from "node:test";
import { JarvisError } from "../../src/errors.js";
import {
  OllamaRuntimeClient,
  ValidatedLocalLLMProvider,
  loadLocalLLMConfig,
  type LocalLLMRuntimeClient,
  type LocalLLMRuntimeResult
} from "../../src/llm/index.js";

class FakeRuntime implements LocalLLMRuntimeClient {
  readonly metadata = { backend: "fake", model: "fake-7b" };
  readonly prompts: string[] = [];
  readonly #result: LocalLLMRuntimeResult;
  constructor(result: LocalLLMRuntimeResult) { this.#result = result; }
  async generate(prompt: string): Promise<LocalLLMRuntimeResult> {
    this.prompts.push(prompt);
    return this.#result;
  }
}

test("validates distinct answer, intent proposal, and no-result contracts", async () => {
  const outputs = [
    ['{"kind":"ANSWER","text":"Краткий ответ."}', "ANSWER"],
    ['{"kind":"INTENT_PROPOSAL","command":{"intent":"OPEN_APPLICATION","parameters":{"application":"Safari"},"confidence":0.8}}', "INTENT_PROPOSAL"],
    ['{"kind":"NO_RESULT"}', "NO_RESULT"]
  ] as const;
  for (const [output, kind] of outputs) {
    const result = await new ValidatedLocalLLMProvider(
      new FakeRuntime({ status: "VALID", output })
    ).interpret("неизвестная команда");
    assert.equal(result.kind, kind);
    assert.equal(Number.isFinite(result.latencyMs), true);
  }
});

test("rejects secrets, controls, oversized input, and malformed or dangerous model output", async () => {
  const safe = new FakeRuntime({ status: "VALID", output: '{"kind":"NO_RESULT"}' });
  const provider = new ValidatedLocalLLMProvider(safe, { maxInputCharacters: 20 });
  for (const input of ["", "token=secret", "password: hunter2", "x\u0000y", "x".repeat(21)]) {
    await assert.rejects(provider.interpret(input), hasCode("LLM_INVALID_INPUT"));
  }
  assert.equal(safe.prompts.length, 0);
  for (const output of [
    "not json",
    '{"kind":"ANSWER","text":"ok","shell":"rm"}',
    '{"kind":"INTENT_PROPOSAL","command":{"intent":"SHELL","parameters":{},"confidence":1}}',
    '{"kind":"INTENT_PROPOSAL","command":{"intent":"OPEN_APPLICATION","parameters":{"application":"Terminal"},"confidence":1}}'
  ]) {
    await assert.rejects(
      new ValidatedLocalLLMProvider(new FakeRuntime({ status: "VALID", output })).interpret("safe"),
      hasCode("LLM_INVALID_RESPONSE")
    );
  }
});

test("maps model availability, timeout, cancellation, and runtime failures safely", async () => {
  await assert.rejects(
    new ValidatedLocalLLMProvider(new FakeRuntime({ status: "INVALID", errorCode: "MODEL_UNAVAILABLE" })).interpret("safe"),
    hasCode("LLM_MODEL_UNAVAILABLE")
  );
  const pending: LocalLLMRuntimeClient = {
    metadata: { backend: "fake", model: "fake" },
    generate: () => new Promise(() => undefined)
  };
  await assert.rejects(
    new ValidatedLocalLLMProvider(pending, { timeoutMilliseconds: 5 }).interpret("safe"),
    hasCode("LLM_TIMEOUT")
  );
  const controller = new AbortController();
  const request = new ValidatedLocalLLMProvider(pending).interpret("safe", { signal: controller.signal });
  controller.abort();
  await assert.rejects(request, hasCode("LLM_CANCELLED"));
  const throwing: LocalLLMRuntimeClient = {
    metadata: { backend: "fake", model: "fake" },
    async generate() { throw new Error("/private/path token=secret"); }
  };
  await assert.rejects(new ValidatedLocalLLMProvider(throwing).interpret("safe"), (error: unknown) =>
    error instanceof JarvisError && error.code === "LLM_RUNTIME_FAILURE" && !error.message.includes("private")
  );
});

test("the first terminal timeout or cancellation reason wins deterministically", async () => {
  const pending: LocalLLMRuntimeClient = {
    metadata: { backend: "fake", model: "fake" },
    generate: () => new Promise(() => undefined)
  };
  const controller = new AbortController();
  const timed = new ValidatedLocalLLMProvider(pending, { timeoutMilliseconds: 1 }).interpret(
    "safe",
    { signal: controller.signal }
  );
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(timed, hasCode("LLM_TIMEOUT"));

  const cancelledController = new AbortController();
  const cancelled = new ValidatedLocalLLMProvider(pending, {
    timeoutMilliseconds: 100
  }).interpret("safe", { signal: cancelledController.signal });
  cancelledController.abort();
  await assert.rejects(cancelled, hasCode("LLM_CANCELLED"));
});

test("Ollama runtime is loopback-only and sends bounded non-streaming structured requests", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const runtime = new OllamaRuntimeClient({
    endpoint: "http://127.0.0.1:11434/api/generate",
    model: "qwen2.5:7b",
    maxOutputTokens: 256,
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ response: '{"kind":"NO_RESULT"}', done: true }));
    }
  });
  assert.deepEqual(await runtime.generate("safe prompt"), {
    status: "VALID", output: '{"kind":"NO_RESULT"}'
  });
  assert.equal(requestBody?.stream, false);
  assert.equal(requestBody?.model, "qwen2.5:7b");
  assert.equal(typeof requestBody?.format, "object");
  assert.deepEqual(requestBody?.options, { temperature: 0, num_predict: 256 });
  for (const endpoint of ["https://127.0.0.1/api/generate", "http://example.com/api/generate", "http://127.0.0.1:11434/other"]) {
    assert.throws(() => new OllamaRuntimeClient({ endpoint, model: "safe", maxOutputTokens: 1 }), hasCode("LLM_MODEL_UNAVAILABLE"));
  }
});

test("concrete Ollama boundary forwards cancellation and distinguishes connection failure", async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const aborting = new OllamaRuntimeClient({
    endpoint: "http://127.0.0.1:11434/api/generate",
    model: "safe:7b",
    maxOutputTokens: 10,
    fetch: (_input, init) => {
      received = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
  });
  const pending = aborting.generate("safe", controller.signal);
  controller.abort();
  await assert.rejects(pending);
  assert.equal(received, controller.signal);

  const unavailable = new OllamaRuntimeClient({
    endpoint: "http://127.0.0.1:11434/api/generate",
    model: "safe:7b",
    maxOutputTokens: 10,
    fetch: async () => { throw new Error("ECONNREFUSED /private/path"); }
  });
  assert.deepEqual(await unavailable.generate("safe"), {
    status: "INVALID", errorCode: "MODEL_UNAVAILABLE"
  });
});

test("loads a local-only 7B default configuration", () => {
  assert.deepEqual(loadLocalLLMConfig({}), {
    backend: "ollama",
    endpoint: "http://127.0.0.1:11434/api/generate",
    model: "qwen2.5:7b",
    timeoutMilliseconds: 30_000,
    maxOutputTokens: 512
  });
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof JarvisError && error.code === code;
}
