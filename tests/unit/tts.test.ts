import assert from "node:assert/strict";
import test from "node:test";
import { JarvisError } from "../../src/errors.js";
import {
  MacOSSystemSpeechRuntime,
  TextToSpeechAdapter,
  TextToSpeechService,
  createLocalTextToSpeechService,
  loadTTSConfig,
  macOSSpeechInvocationFor,
  type MacOSSpeechProcessInput,
  type MacOSSpeechProcessRunner,
  type TTSRuntimeClient,
  type TTSRuntimeInput,
  type TTSRuntimeResult
} from "../../src/tts/index.js";

const metadata = { backend: "fake-tts", voice: "Test Voice", rateWordsPerMinute: 180 };

class FakeRuntime implements TTSRuntimeClient {
  readonly metadata = metadata;
  readonly #operation: (input: TTSRuntimeInput, signal?: AbortSignal) => Promise<TTSRuntimeResult>;

  constructor(
    operation: (input: TTSRuntimeInput, signal?: AbortSignal) => Promise<TTSRuntimeResult>
  ) {
    this.#operation = operation;
  }

  speak(input: TTSRuntimeInput, signal?: AbortSignal): Promise<TTSRuntimeResult> {
    return this.#operation(input, signal);
  }
}

class FakeProcessRunner implements MacOSSpeechProcessRunner {
  readonly inputs: MacOSSpeechProcessInput[] = [];
  readonly #operation: (
    input: MacOSSpeechProcessInput,
    signal?: AbortSignal
  ) => Promise<{ readonly exitCode: number }>;

  constructor(
    operation: (
      input: MacOSSpeechProcessInput,
      signal?: AbortSignal
    ) => Promise<{ readonly exitCode: number }>
  ) {
    this.#operation = operation;
  }

  speakCount = 0;

  run(input: MacOSSpeechProcessInput, signal?: AbortSignal): Promise<{ readonly exitCode: number }> {
    this.speakCount += 1;
    this.inputs.push({ ...input });
    return this.#operation(input, signal);
  }
}

function serviceFor(result: TTSRuntimeResult): TextToSpeechService {
  return new TextToSpeechService(
    new TextToSpeechAdapter(new FakeRuntime(async () => result))
  );
}

async function assertJarvisCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof JarvisError);
    assert.equal(error.code, code);
    assert.equal(error.details, undefined);
    return true;
  });
}

test("plays validated Russian, English, and mixed structured response text", async () => {
  const spoken: string[] = [];
  const runtime = new FakeRuntime(async (input) => {
    spoken.push(input.text);
    return { status: "COMPLETED" };
  });
  const service = new TextToSpeechService(new TextToSpeechAdapter(runtime));
  for (const [text, language] of [
    ["Готово.", "RU"],
    ["Done.", "EN"],
    ["Safari открыт.", "RU"]
  ] as const) {
    const result = await service.speak({ text, language });
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.characterCount, text.length);
    assert.ok(result.playbackLatencyMs >= 0);
    assert.deepEqual(result.backendMetadata, metadata);
  }
  assert.deepEqual(spoken, ["Готово.", "Done.", "Safari открыт."]);
});

test("snapshots and normalizes text before the asynchronous runtime boundary", async () => {
  const request = { text: "  Готово.\nСистема работает.  ", language: "RU" as const };
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = new FakeRuntime(async (input) => {
    await waiting;
    assert.equal(input.text, "Готово. Система работает.");
    return { status: "COMPLETED" };
  });
  const pending = new TextToSpeechService(new TextToSpeechAdapter(runtime)).speak(request);
  request.text = "mutated";
  release?.();
  await pending;
});

test("rejects empty, oversized, malformed, control, unicode, and language input", async () => {
  const service = serviceFor({ status: "COMPLETED" });
  const invalid = [
    { text: "" },
    { text: "   " },
    { text: "x".repeat(1_001) },
    { text: "bad\u0000text" },
    { text: "bad\u202Etext" },
    { text: "bad\uD800text" },
    { text: "ok", language: "DE" }
  ];
  for (const request of invalid) {
    await assertJarvisCode(service.speak(request as never), "TTS_INVALID_TEXT");
  }
  await assertJarvisCode(service.speak(null as never), "TTS_INVALID_TEXT");
  const hostile = Object.defineProperty({}, "text", {
    get() {
      throw new Error("sensitive getter");
    }
  });
  await assertJarvisCode(service.speak(hostile as never), "TTS_INVALID_TEXT");
});

test("maps voice, playback, thrown, and malformed runtime failures safely", async () => {
  await assertJarvisCode(
    serviceFor({ status: "INVALID", errorCode: "VOICE_UNAVAILABLE" }).speak({ text: "test" }),
    "TTS_VOICE_UNAVAILABLE"
  );
  await assertJarvisCode(
    serviceFor({ status: "INVALID", errorCode: "PLAYBACK_FAILED" }).speak({ text: "test" }),
    "TTS_RUNTIME_FAILURE"
  );
  const throwing = new FakeRuntime(async () => {
    throw new Error("/private/audio token=secret spoken text");
  });
  await assertJarvisCode(
    new TextToSpeechService(new TextToSpeechAdapter(throwing)).speak({ text: "test" }),
    "TTS_RUNTIME_FAILURE"
  );
  await assertJarvisCode(
    serviceFor({ status: "BROKEN" } as never).speak({ text: "test" }),
    "TTS_INVALID_RESPONSE"
  );
  const hostileMetadata = new FakeRuntime(async () => ({ status: "COMPLETED" }));
  Object.defineProperty(hostileMetadata, "metadata", {
    get() {
      throw new Error("sensitive metadata getter");
    }
  });
  assert.throws(
    () => new TextToSpeechAdapter(hostileMetadata),
    (error: unknown) => error instanceof JarvisError && error.code === "TTS_INVALID_RESPONSE"
  );
});

test("bounds non-cooperative playback and preserves external cancellation", async () => {
  const hanging = new FakeRuntime(async () => new Promise<TTSRuntimeResult>(() => {}));
  await assertJarvisCode(
    new TextToSpeechService(
      new TextToSpeechAdapter(hanging, { timeoutMilliseconds: 5 })
    ).speak({ text: "timeout" }),
    "TTS_TIMEOUT"
  );
  const controller = new AbortController();
  const pending = new TextToSpeechService(new TextToSpeechAdapter(hanging)).speak(
    { text: "cancel" },
    { signal: controller.signal }
  );
  controller.abort();
  await assertJarvisCode(pending, "TTS_CANCELLED");
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assertJarvisCode(
    new TextToSpeechService(new TextToSpeechAdapter(hanging)).speak(
      { text: "cancel" },
      { signal: alreadyAborted.signal }
    ),
    "TTS_CANCELLED"
  );
});

test("maps macOS say to fixed executable and argv and rejects forged invocation", () => {
  assert.deepEqual(
    macOSSpeechInvocationFor({ text: "Готово.", voice: "Milena", rateWordsPerMinute: 180 }),
    {
      executable: "/usr/bin/say",
      arguments: ["-v", "Milena", "-r", "180", "Готово."]
    }
  );
  for (const input of [
    { text: "", voice: "Milena", rateWordsPerMinute: 180 },
    { text: "test", voice: "Milena; rm", rateWordsPerMinute: 180 },
    { text: "bad\u0000text", voice: "Milena", rateWordsPerMinute: 180 },
    { text: " padded ", voice: "Milena", rateWordsPerMinute: 180 },
    { text: "test", voice: "Milena", rateWordsPerMinute: 0 },
    null
  ]) {
    assert.throws(
      () => macOSSpeechInvocationFor(input as never),
      (error: unknown) => error instanceof JarvisError && error.code === "TTS_INVALID_TEXT"
    );
  }
});

test("concrete macOS runtime passes config to a cancellable process runner", async () => {
  const runner = new FakeProcessRunner(async () => ({ exitCode: 0 }));
  const runtime = new MacOSSystemSpeechRuntime("Milena", 180, runner);
  assert.deepEqual(await runtime.speak({ text: "Готово." }), { status: "COMPLETED" });
  assert.deepEqual(runner.inputs, [
    { text: "Готово.", voice: "Milena", rateWordsPerMinute: 180 }
  ]);

  const abortAware = new FakeProcessRunner(
    async (_input, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        );
      })
  );
  const service = new TextToSpeechService(
    new TextToSpeechAdapter(new MacOSSystemSpeechRuntime("Milena", 180, abortAware))
  );
  const controller = new AbortController();
  const cancelled = service.speak({ text: "Длинная реплика" }, { signal: controller.signal });
  controller.abort();
  await assertJarvisCode(cancelled, "TTS_CANCELLED");
});

test("loads configurable local TTS settings and wires the factory", async () => {
  assert.deepEqual(loadTTSConfig({}), {
    backend: "macos-say",
    voice: "Milena",
    rateWordsPerMinute: 180,
    timeoutMilliseconds: 30_000,
    maxSpeechCharacters: 1_000
  });
  const runner = new FakeProcessRunner(async () => ({ exitCode: 0 }));
  const service = createLocalTextToSpeechService({
    environment: {
      JARVIS_TTS_VOICE: "Milena",
      JARVIS_TTS_RATE_WPM: "200",
      JARVIS_TTS_TIMEOUT_MS: "5000",
      JARVIS_TTS_MAX_CHARACTERS: "200"
    },
    runner
  });
  await service.speak({ text: "Проверка." });
  assert.equal(runner.inputs[0]?.rateWordsPerMinute, 200);
  for (const environment of [
    { JARVIS_TTS_BACKEND: "cloud" },
    { JARVIS_TTS_VOICE: "bad;voice" },
    { JARVIS_TTS_RATE_WPM: "0" },
    { JARVIS_TTS_TIMEOUT_MS: "0" },
    { JARVIS_TTS_MAX_CHARACTERS: "0" },
    { JARVIS_TTS_MAX_CHARACTERS: "1001" }
  ]) {
    assert.throws(() => loadTTSConfig(environment), JarvisError);
  }
});
