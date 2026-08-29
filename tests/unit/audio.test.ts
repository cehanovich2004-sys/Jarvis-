import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AudioSession,
  BoundedAudioBuffer,
  RecordedAudioInput,
  validateAudioChunk,
  type AudioChunk,
  type MicrophoneInput,
  type VoiceActivity,
  type VoiceActivityDetector
} from "../../src/audio/index.js";
import { JarvisError } from "../../src/errors.js";

function chunk(samples: ArrayLike<number>, overrides: Partial<AudioChunk> = {}): AudioChunk {
  return {
    sampleRate: 16_000,
    channels: 1,
    format: "pcm-f32",
    samples: new Float32Array(samples),
    ...overrides
  };
}

function assertJarvisCode(action: () => unknown, code: JarvisError["code"]): void {
  assert.throws(action, (error: unknown) => error instanceof JarvisError && error.code === code);
}

class SequenceVad implements VoiceActivityDetector {
  readonly #activities: VoiceActivity[];
  resetCount = 0;

  constructor(activities: VoiceActivity[]) {
    this.#activities = [...activities];
  }

  async process(): Promise<VoiceActivity> {
    return this.#activities.shift() ?? "SILENCE";
  }

  reset(): void {
    this.resetCount += 1;
  }
}

class TrackingInput implements MicrophoneInput {
  readonly #chunks: readonly AudioChunk[];
  readonly #failure: Error | undefined;
  closed = false;

  constructor(chunks: readonly AudioChunk[], failure?: Error) {
    this.#chunks = chunks;
    this.#failure = failure;
  }

  async *chunks(): AsyncIterable<AudioChunk> {
    for (const item of this.#chunks) {
      yield item;
    }
    if (this.#failure !== undefined) {
      throw this.#failure;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class HangingInput implements MicrophoneInput {
  closed = false;

  async *chunks(signal?: AbortSignal): AsyncIterable<AudioChunk> {
    await new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class NonCooperativeInput implements MicrophoneInput {
  closed = false;

  async *chunks(): AsyncIterable<AudioChunk> {
    await new Promise<void>(() => undefined);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class HangingVad implements VoiceActivityDetector {
  async process(): Promise<VoiceActivity> {
    return await new Promise<VoiceActivity>(() => undefined);
  }

  reset(): void {}
}

test("validates the mono 16 kHz float32 audio contract", () => {
  assert.doesNotThrow(() => validateAudioChunk(chunk([-1, 0, 1])));
});

test("rejects empty, malformed, unsupported, and non-finite audio", () => {
  assertJarvisCode(() => validateAudioChunk(chunk([])), "AUDIO_INVALID");
  assertJarvisCode(() => validateAudioChunk(chunk([0], { sampleRate: 44_100 })), "AUDIO_INVALID");
  assertJarvisCode(() => validateAudioChunk(chunk([0], { channels: 2 })), "AUDIO_INVALID");
  assertJarvisCode(() => validateAudioChunk(chunk([Number.NaN])), "AUDIO_INVALID");
  assertJarvisCode(() => validateAudioChunk(chunk([1.01])), "AUDIO_INVALID");
});

test("bounded buffer copies input and reports consistent duration", () => {
  const samples = new Float32Array([0.25, -0.5]);
  const buffer = new BoundedAudioBuffer({ maxDurationSeconds: 1, maxBufferBytes: 64 });

  buffer.append(chunk(samples));
  samples[0] = 1;
  const result = buffer.snapshot();

  assert.deepEqual([...result.samples], [0.25, -0.5]);
  assert.equal(result.durationSeconds, 2 / 16_000);
  assert.equal(buffer.sampleCount, 2);
  buffer.clear();
  assert.equal(buffer.sampleCount, 0);
});

test("bounded buffer rejects byte and duration overflow without partial append", () => {
  const byBytes = new BoundedAudioBuffer({ maxDurationSeconds: 1, maxBufferBytes: 4 });
  assertJarvisCode(() => byBytes.append(chunk([0, 0])), "AUDIO_BUFFER_OVERFLOW");
  assert.equal(byBytes.sampleCount, 0);

  const byDuration = new BoundedAudioBuffer({ maxDurationSeconds: 1 / 16_000, maxBufferBytes: 64 });
  assertJarvisCode(() => byDuration.append(chunk([0, 0])), "AUDIO_BUFFER_OVERFLOW");
  assert.equal(byDuration.sampleCount, 0);
});

test("recorded input supports deterministic microphone-free playback", async () => {
  const input = new RecordedAudioInput([chunk([0.125]), chunk([0.25])]);
  const observed: number[] = [];

  for await (const item of input.chunks()) {
    observed.push(item.samples[0] ?? 0);
  }
  await input.close();

  assert.deepEqual(observed, [0.125, 0.25]);
});

test("audio session completes on a valid VAD lifecycle and releases resources", async () => {
  const input = new TrackingInput([chunk([0]), chunk([0.5]), chunk([0.25])]);
  const vad = new SequenceVad(["SILENCE", "SPEECH_START", "SPEECH_END"]);
  const session = new AudioSession(input, vad, { timeoutMilliseconds: 1_000 });

  const result = await session.run();

  assert.equal(result.state, "COMPLETE");
  assert.deepEqual(result.state === "COMPLETE" ? [...result.audio.samples] : [], [0.5, 0.25]);
  assert.equal(session.state, "COMPLETE");
  assert.equal(input.closed, true);
  assert.equal(vad.resetCount, 2);
});

test("audio session returns timeout and closes a hanging microphone", async () => {
  const input = new HangingInput();
  const session = new AudioSession(input, new SequenceVad([]), { timeoutMilliseconds: 5 });

  const result = await session.run();

  assert.deepEqual(result, { state: "TIMEOUT", audio: null });
  assert.equal(session.state, "TIMEOUT");
  assert.equal(input.closed, true);
});

test("audio session enforces timeout when a microphone ignores cancellation", async () => {
  const input = new NonCooperativeInput();
  const session = new AudioSession(input, new SequenceVad([]), { timeoutMilliseconds: 5 });

  const result = await session.run();

  assert.deepEqual(result, { state: "TIMEOUT", audio: null });
  assert.equal(input.closed, true);
});

test("audio session enforces timeout when VAD processing stalls", async () => {
  const input = new TrackingInput([chunk([0.25])]);
  const session = new AudioSession(input, new HangingVad(), { timeoutMilliseconds: 5 });

  const result = await session.run();

  assert.deepEqual(result, { state: "TIMEOUT", audio: null });
  assert.equal(input.closed, true);
});

test("audio session returns cancelled for an aborted request", async () => {
  const input = new HangingInput();
  const controller = new AbortController();
  const session = new AudioSession(input, new SequenceVad([]), { timeoutMilliseconds: 1_000 });
  const running = session.run(controller.signal);

  controller.abort();
  const result = await running;

  assert.deepEqual(result, { state: "CANCELLED", audio: null });
  assert.equal(input.closed, true);
});

test("audio session maps microphone failures to a safe Jarvis error and closes input", async () => {
  const input = new TrackingInput([], new Error("device path and private details"));
  const session = new AudioSession(input, new SequenceVad([]), { timeoutMilliseconds: 1_000 });

  await assert.rejects(
    session.run(),
    (error: unknown) =>
      error instanceof JarvisError &&
      error.code === "AUDIO_INPUT_FAILURE" &&
      error.message === "Audio input failed." &&
      !error.message.includes("private details")
  );
  assert.equal(session.state, "ERROR");
  assert.equal(input.closed, true);
});

test("audio session rejects invalid VAD transitions", async () => {
  const input = new TrackingInput([chunk([0.1])]);
  const session = new AudioSession(input, new SequenceVad(["SPEECH_END"]), {
    timeoutMilliseconds: 1_000
  });

  await assert.rejects(
    session.run(),
    (error: unknown) => error instanceof JarvisError && error.code === "AUDIO_INVALID"
  );
  assert.equal(input.closed, true);
});

test("audio session is single-use", async () => {
  const session = new AudioSession(
    new TrackingInput([chunk([0.25]), chunk([0.25])]),
    new SequenceVad(["SPEECH_START", "SPEECH_END"]),
    { timeoutMilliseconds: 1_000 }
  );

  await session.run();
  await assert.rejects(
    session.run(),
    (error: unknown) => error instanceof JarvisError && error.code === "AUDIO_INVALID"
  );
});

test("audio session sanitizes resource cleanup failures", async () => {
  const input: MicrophoneInput = {
    async *chunks(): AsyncIterable<AudioChunk> {
      yield chunk([0.5]);
      yield chunk([0.25]);
    },
    async close(): Promise<void> {
      throw new Error("private device identifier");
    }
  };
  const session = new AudioSession(input, new SequenceVad(["SPEECH_START", "SPEECH_END"]), {
    timeoutMilliseconds: 1_000
  });

  await assert.rejects(
    session.run(),
    (error: unknown) =>
      error instanceof JarvisError &&
      error.code === "AUDIO_INPUT_FAILURE" &&
      error.message === "Audio resource cleanup failed." &&
      !error.message.includes("private device")
  );
  assert.equal(session.state, "ERROR");
});
