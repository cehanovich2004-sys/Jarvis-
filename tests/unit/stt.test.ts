import assert from "node:assert/strict";
import test from "node:test";
import type { AudioData } from "../../src/audio/contracts.js";
import { JarvisError } from "../../src/errors.js";
import {
  SpeechToTextAdapter,
  SpeechToTextService,
  WhisperCppRuntimeClient,
  createLocalSpeechToTextService,
  encodePcm16Wav,
  loadSTTConfig,
  type STTAudioInput,
  type STTRuntimeClient,
  type STTRuntimeResult
} from "../../src/stt/index.js";

const metadata = { backend: "fake-stt", backendVersion: "1.0.0", model: "test-model" };

class FakeRuntime implements STTRuntimeClient {
  readonly metadata = metadata;
  readonly #operation: (
    input: STTAudioInput,
    signal?: AbortSignal
  ) => Promise<STTRuntimeResult>;

  constructor(
    operation: (input: STTAudioInput, signal?: AbortSignal) => Promise<STTRuntimeResult>
  ) {
    this.#operation = operation;
  }

  transcribe(input: STTAudioInput, signal?: AbortSignal): Promise<STTRuntimeResult> {
    return this.#operation(input, signal);
  }
}

function audio(sampleCount = 160): AudioData {
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * 440 * index) / 16_000) * 0.2;
  }
  return {
    sampleRate: 16_000,
    channels: 1,
    format: "pcm-f32",
    samples,
    durationSeconds: sampleCount / 16_000
  };
}

function serviceFor(result: STTRuntimeResult): SpeechToTextService {
  const runtime = new FakeRuntime(async () => result);
  return new SpeechToTextService(new SpeechToTextAdapter(runtime));
}

async function assertJarvisCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof JarvisError);
    assert.equal(error.code, code);
    assert.equal(error.details, undefined);
    return true;
  });
}

test("transcribes Russian, English, and mixed-language text without destructive normalization", async () => {
  const cases = [
    { text: "Джарвис, открой Safari.", language: "ru" },
    { text: "Open GitHub.", language: "en" },
    { text: "Запусти VS Code.", language: "ru" }
  ];
  for (const expected of cases) {
    const result = await serviceFor({ status: "SUCCESS", ...expected, confidence: 0.91 }).transcribe(
      audio()
    );
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.text, expected.text);
    assert.equal(result.language, expected.language);
    assert.equal(result.confidence, 0.91);
    assert.equal(result.durationSeconds, 0.01);
    assert.ok(result.transcriptionLatencyMs >= 0);
    assert.deepEqual(result.backendMetadata, metadata);
  }
});

test("preserves explicit empty and uncertain transcript states", async () => {
  const empty = await serviceFor({ status: "EMPTY", text: " \n " }).transcribe(audio());
  assert.deepEqual({ status: empty.status, text: empty.text }, { status: "EMPTY", text: "" });

  const uncertain = await serviceFor({
    status: "UNCERTAIN",
    text: "Открой Telegram",
    confidence: 0.31
  }).transcribe(audio());
  assert.equal(uncertain.status, "UNCERTAIN");
  assert.equal(uncertain.confidence, 0.31);
});

test("passes AUTO, RU, and EN modes explicitly to the runtime", async () => {
  const modes: string[] = [];
  const runtime = new FakeRuntime(async (input) => {
    modes.push(input.languageMode);
    return { status: "SUCCESS", text: "ok" };
  });
  const service = new SpeechToTextService(new SpeechToTextAdapter(runtime));
  await service.transcribe(audio());
  await service.transcribe(audio(), { languageMode: "RU" });
  await service.transcribe(audio(), { languageMode: "EN" });
  assert.deepEqual(modes, ["AUTO", "RU", "EN"]);
});

test("snapshots audio before the asynchronous runtime boundary", async () => {
  const source = audio();
  const firstSample = source.samples[0];
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = new FakeRuntime(async (input) => {
    await waiting;
    assert.notEqual(input.waveform, source.samples);
    assert.equal(input.waveform[0], firstSample);
    input.waveform[0] = 0.75;
    return { status: "SUCCESS", text: "snapshot" };
  });
  const pending = new SpeechToTextService(new SpeechToTextAdapter(runtime)).transcribe(source);
  source.samples[0] = -0.75;
  release?.();
  await pending;
  assert.equal(source.samples[0], -0.75);
});

test("rejects invalid audio before invoking the runtime", async () => {
  let called = false;
  const runtime = new FakeRuntime(async () => {
    called = true;
    return { status: "SUCCESS", text: "unexpected" };
  });
  const invalid = { ...audio(), durationSeconds: 1 };
  await assertJarvisCode(
    new SpeechToTextService(new SpeechToTextAdapter(runtime)).transcribe(invalid),
    "STT_INVALID_AUDIO"
  );
  assert.equal(called, false);
});

test("rejects malformed transcript status, text, controls, unicode, length, and metadata", async () => {
  const malformed: STTRuntimeResult[] = [
    { status: "SUCCESS", text: "" },
    { status: "EMPTY", text: "not empty" },
    { status: "SUCCESS", text: "bad\u0000text" },
    { status: "SUCCESS", text: "bad\u202Etext" },
    { status: "SUCCESS", text: "bad\uD800text" },
    { status: "SUCCESS", text: "x".repeat(4_097) },
    { status: "SUCCESS", text: "ok", language: "../../bad" },
    { status: "SUCCESS", text: "ok", confidence: Number.NaN },
    { status: "SUCCESS", text: "ok", languageConfidence: 0.9 },
    { status: "SUCCESS", text: "ok", language: "en", languageConfidence: 2 }
  ];
  for (const result of malformed) {
    await assertJarvisCode(serviceFor(result).transcribe(audio()), "STT_INVALID_RESPONSE");
  }
  const badRuntime = new FakeRuntime(async () => ({ status: "SUCCESS", text: "ok" }));
  Object.defineProperty(badRuntime, "metadata", { value: { backend: "bad\nvalue", model: "x" } });
  assert.throws(() => new SpeechToTextAdapter(badRuntime), (error: unknown) => {
    assert.ok(error instanceof JarvisError);
    assert.equal(error.code, "STT_INVALID_RESPONSE");
    return true;
  });
});

test("fails closed on hostile runtime objects and snapshots backend metadata", async () => {
  const hostile = new FakeRuntime(async () =>
    Object.defineProperty({}, "status", {
      get() {
        throw new Error("sensitive runtime getter");
      }
    }) as STTRuntimeResult
  );
  await assertJarvisCode(
    new SpeechToTextService(new SpeechToTextAdapter(hostile)).transcribe(audio()),
    "STT_INVALID_RESPONSE"
  );

  const runtime = new FakeRuntime(async () => ({ status: "SUCCESS", text: "safe" }));
  const adapter = new SpeechToTextAdapter(runtime);
  Object.defineProperty(runtime, "metadata", {
    value: { backend: "mutated", model: "mutated" }
  });
  const result = await new SpeechToTextService(adapter).transcribe(audio());
  assert.deepEqual(result.backendMetadata, metadata);

  await assertJarvisCode(
    new SpeechToTextService(adapter).transcribe(audio(), {
      languageMode: "DE" as never
    }),
    "STT_INVALID_RESPONSE"
  );
});

test("maps runtime errors without leaking backend exception content", async () => {
  const mappings = [
    { result: { status: "INVALID", errorCode: "INVALID_AUDIO" }, code: "STT_INVALID_AUDIO" },
    {
      result: { status: "INVALID", errorCode: "MODEL_UNAVAILABLE" },
      code: "STT_MODEL_UNAVAILABLE"
    },
    { result: { status: "INVALID", errorCode: "INFERENCE_FAILED" }, code: "STT_RUNTIME_FAILURE" },
    {
      result: { status: "INVALID", errorCode: "MEMORY_LIMIT_EXCEEDED" },
      code: "STT_RUNTIME_FAILURE"
    }
  ] as const;
  for (const item of mappings) {
    await assertJarvisCode(serviceFor(item.result).transcribe(audio()), item.code);
  }

  const runtime = new FakeRuntime(async () => {
    throw new Error("/private/user/audio.wav secret-token transcript=private");
  });
  await assertJarvisCode(
    new SpeechToTextService(new SpeechToTextAdapter(runtime)).transcribe(audio()),
    "STT_RUNTIME_FAILURE"
  );
});

test("bounds a non-cooperative runtime and supports cancellation", async () => {
  const hanging = new FakeRuntime(async () => new Promise<STTRuntimeResult>(() => {}));
  await assertJarvisCode(
    new SpeechToTextService(
      new SpeechToTextAdapter(hanging, { timeoutMilliseconds: 5 })
    ).transcribe(audio()),
    "STT_TIMEOUT"
  );

  const controller = new AbortController();
  const pending = new SpeechToTextService(new SpeechToTextAdapter(hanging)).transcribe(audio(), {
    signal: controller.signal
  });
  controller.abort();
  await assertJarvisCode(pending, "STT_CANCELLED");

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assertJarvisCode(
    new SpeechToTextService(new SpeechToTextAdapter(hanging)).transcribe(audio(), {
      signal: alreadyAborted.signal
    }),
    "STT_CANCELLED"
  );
});

test("loads bounded local-first STT configuration", () => {
  assert.deepEqual(loadSTTConfig({}), {
    backend: "whisper.cpp",
    model: "base",
    languageMode: "AUTO",
    timeoutMilliseconds: 30_000,
    endpoint: "http://127.0.0.1:8080/inference"
  });
  assert.equal(
    loadSTTConfig({
      JARVIS_STT_MODEL: "small-q5_1",
      JARVIS_STT_LANGUAGE: "ru",
      JARVIS_STT_TIMEOUT_MS: "45000"
    }).languageMode,
    "RU"
  );
  for (const environment of [
    { JARVIS_STT_BACKEND: "cloud" },
    { JARVIS_STT_MODEL: "../../model" },
    { JARVIS_STT_LANGUAGE: "DE" },
    { JARVIS_STT_TIMEOUT_MS: "0" }
  ]) {
    assert.throws(() => loadSTTConfig(environment), JarvisError);
  }
});

test("local factory wires config to the whisper.cpp runtime without native dependencies", async () => {
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("language"), "ru");
    return new Response(JSON.stringify({ text: "Открой GitHub", language: "Russian" }));
  };
  const service = createLocalSpeechToTextService({
    environment: {
      JARVIS_STT_MODEL: "small-q5_1",
      JARVIS_STT_LANGUAGE: "RU",
      JARVIS_STT_ENDPOINT: "http://localhost:8080/inference"
    },
    backendVersion: "1.9.1",
    fetch
  });
  const result = await service.transcribe(audio());
  assert.equal(result.text, "Открой GitHub");
  assert.deepEqual(result.backendMetadata, {
    backend: "whisper.cpp",
    backendVersion: "1.9.1",
    model: "small-q5_1"
  });
});

test("whisper.cpp runtime posts in-memory WAV to loopback and parses verbose JSON", async () => {
  let requestBody: FormData | undefined;
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof FormData);
    requestBody = init.body;
    return new Response(
      JSON.stringify({
        text: " Джарвис, открой Safari. ",
        language: "Russian",
        detected_language_probability: 0.94
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const runtime = new WhisperCppRuntimeClient({
    endpoint: "http://127.0.0.1:8080/inference",
    model: "base",
    backendVersion: "1.9.1",
    fetch
  });
  const result = await runtime.transcribe({
    waveform: audio().samples,
    sampleRateHz: 16_000,
    channels: 1,
    format: "pcm-f32",
    languageMode: "AUTO"
  });
  assert.deepEqual(result, {
    status: "SUCCESS",
    text: " Джарвис, открой Safari. ",
    language: "ru",
    languageConfidence: 0.94
  });
  assert.equal(requestBody?.get("language"), "auto");
  assert.equal(requestBody?.get("detect_language"), "true");
  const file = requestBody?.get("file");
  assert.ok(file instanceof Blob);
  const wav = new Uint8Array(await file.arrayBuffer());
  assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), "RIFF");
  assert.equal(new DataView(wav.buffer).getUint32(24, true), 16_000);
});

test("whisper.cpp runtime rejects non-loopback endpoints and bounds responses", async () => {
  for (const endpoint of [
    "https://127.0.0.1:8080/inference",
    "http://example.com/inference",
    "http://user:pass@localhost/inference"
  ]) {
    assert.throws(
      () => new WhisperCppRuntimeClient({ endpoint, model: "base" }),
      JarvisError
    );
  }
  const fetch: typeof globalThis.fetch = async () =>
    new Response("x", { status: 200, headers: { "content-length": "1048577" } });
  const runtime = new WhisperCppRuntimeClient({
    endpoint: "http://localhost:8080/inference",
    model: "base",
    fetch
  });
  assert.deepEqual(
    await runtime.transcribe({
      waveform: audio().samples,
      sampleRateHz: 16_000,
      channels: 1,
      format: "pcm-f32",
      languageMode: "EN"
    }),
    { status: "INVALID", errorCode: "INFERENCE_FAILED" }
  );

  const streamingFetch: typeof globalThis.fetch = async () =>
    new Response("x".repeat(1_048_577), { status: 200 });
  const streamingRuntime = new WhisperCppRuntimeClient({
    endpoint: "http://localhost:8080/inference",
    model: "base",
    fetch: streamingFetch
  });
  assert.deepEqual(
    await streamingRuntime.transcribe({
      waveform: audio().samples,
      sampleRateHz: 16_000,
      channels: 1,
      format: "pcm-f32",
      languageMode: "AUTO"
    }),
    { status: "INVALID", errorCode: "INFERENCE_FAILED" }
  );
});

test("PCM16 WAV conversion is deterministic and safely clips boundaries", () => {
  const wav = encodePcm16Wav(new Float32Array([-1, -0.5, 0, 0.5, 1]));
  const view = new DataView(wav.buffer);
  assert.equal(wav.length, 54);
  assert.equal(view.getInt16(44, true), -32_768);
  assert.equal(view.getInt16(46, true), -16_384);
  assert.equal(view.getInt16(48, true), 0);
  assert.equal(view.getInt16(50, true), 16_384);
  assert.equal(view.getInt16(52, true), 32_767);
  assert.deepEqual(wav, encodePcm16Wav(new Float32Array([-1, -0.5, 0, 0.5, 1])));
});
