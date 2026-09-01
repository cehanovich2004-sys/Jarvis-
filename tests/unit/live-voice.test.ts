import assert from "node:assert/strict";
import test from "node:test";
import {
  EnergyVoiceActivityDetector,
  MacOSMicrophoneInput,
  ffmpegArguments,
  type AudioChunk,
  type MicrophoneCaptureProcess,
  type MicrophoneProcessRunner
} from "../../src/audio/index.js";
import { JarvisError } from "../../src/errors.js";
import { VoiceInteractionStateMachine } from "../../src/interaction/index.js";
import { loadLiveVoiceConfiguration } from "../../src/live-voice/index.js";

class FakeProcess implements MicrophoneCaptureProcess {
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly exited: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  terminateCalls = 0;

  constructor(chunks: readonly Uint8Array[], exitCode = 0) {
    this.stdout = (async function* () {
      for (const chunk of chunks) yield chunk;
    })();
    this.exited = Promise.resolve({ exitCode, signal: null });
  }

  terminate(): void {
    this.terminateCalls += 1;
  }
}

class FakeRunner implements MicrophoneProcessRunner {
  readonly process: FakeProcess;
  executable: string | null = null;
  arguments: readonly string[] = [];

  constructor(process: FakeProcess) {
    this.process = process;
  }

  start(executable: string, arguments_: readonly string[]): MicrophoneCaptureProcess {
    this.executable = executable;
    this.arguments = [...arguments_];
    return this.process;
  }
}

function chunk(value: number, samples = 1_600): AudioChunk {
  return {
    sampleRate: 16_000,
    channels: 1,
    format: "pcm-f32",
    samples: new Float32Array(samples).fill(value)
  };
}

function float32Bytes(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

test("energy VAD detects speech and a deterministic end-of-utterance silence", async () => {
  const vad = new EnergyVoiceActivityDetector({
    speechThreshold: 0.02,
    endSilenceMilliseconds: 300
  });
  assert.equal(await vad.process(chunk(0)), "SILENCE");
  assert.equal(await vad.process(chunk(0.1)), "SPEECH_START");
  assert.equal(await vad.process(chunk(0.1)), "SPEECH");
  assert.equal(await vad.process(chunk(0)), "TRAILING_SILENCE");
  assert.equal(await vad.process(chunk(0)), "TRAILING_SILENCE");
  assert.equal(await vad.process(chunk(0)), "SPEECH_END");
  vad.reset();
  assert.equal(await vad.process(chunk(0)), "SILENCE");
});

test("energy VAD default preserves brief pauses and ends after 500 ms", async () => {
  const vad = new EnergyVoiceActivityDetector();
  assert.equal(await vad.process(chunk(0.1)), "SPEECH_START");
  for (let index = 0; index < 4; index += 1) {
    assert.equal(await vad.process(chunk(0)), "TRAILING_SILENCE");
  }
  assert.equal(await vad.process(chunk(0)), "SPEECH_END");
});

test("macOS microphone adapter emits mono 16 kHz float32 from fragmented bytes", async () => {
  const bytes = float32Bytes([0.25, -0.5, 0.75]);
  const process = new FakeProcess([bytes.slice(0, 3), bytes.slice(3, 9), bytes.slice(9)]);
  const runner = new FakeRunner(process);
  const input = new MacOSMicrophoneInput({
    runner,
    chunkMilliseconds: 20
  });
  const observed: number[] = [];
  for await (const audio of input.chunks()) observed.push(...audio.samples);
  await input.close();

  assert.deepEqual(observed, [0.25, -0.5, 0.75]);
  assert.equal(runner.executable, "/opt/homebrew/bin/ffmpeg");
  assert.deepEqual(runner.arguments, ffmpegArguments(0));
  assert.equal(process.terminateCalls, 1);
});

test("microphone adapter rejects truncated, non-finite, failed, and unsafe input", async () => {
  for (const [chunks, exitCode] of [
    [[new Uint8Array([1, 2, 3])], 0],
    [[float32Bytes([Number.NaN])], 0],
    [[float32Bytes([0.1])], 1]
  ] as const) {
    const input = new MacOSMicrophoneInput({
      runner: new FakeRunner(new FakeProcess(chunks, exitCode)),
      chunkMilliseconds: 20
    });
    await assert.rejects(async () => {
      for await (const _chunk of input.chunks()) { /* consume */ }
    }, hasCode("AUDIO_INPUT_FAILURE"));
    await input.close();
  }
  assert.throws(
    () => new MacOSMicrophoneInput({ executable: "/tmp/ffmpeg" }),
    hasCode("AUDIO_INPUT_FAILURE")
  );
});

test("microphone adapter forwards cancellation to process cleanup", async () => {
  let resume: (() => void) | undefined;
  const process: MicrophoneCaptureProcess & { terminateCalls: number } = {
    stdout: (async function* () {
      await new Promise<void>((resolve) => { resume = resolve; });
    })(),
    exited: Promise.resolve({ exitCode: null, signal: "SIGTERM" }),
    terminateCalls: 0,
    terminate() {
      this.terminateCalls += 1;
      resume?.();
    }
  };
  const input = new MacOSMicrophoneInput({ runner: { start: () => process } });
  const controller = new AbortController();
  const consuming = (async () => {
    for await (const _chunk of input.chunks(controller.signal)) { /* consume */ }
  })();
  controller.abort();
  await consuming;
  await input.close();
  assert.equal(process.terminateCalls >= 1, true);
});

test("microphone cleanup escalates from graceful termination to a bounded forced kill", async () => {
  let settle: ((value: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) | undefined;
  const signals: boolean[] = [];
  const process: MicrophoneCaptureProcess = {
    stdout: (async function* () { yield float32Bytes([0.1]); })(),
    exited: new Promise((resolve) => { settle = resolve; }),
    terminate(force = false) {
      signals.push(force);
      if (force) settle?.({ exitCode: null, signal: "SIGKILL" });
    }
  };
  const input = new MacOSMicrophoneInput({
    runner: { start: () => process },
    cleanupTimeoutMilliseconds: 5,
    chunkMilliseconds: 20
  });
  const iterator = input.chunks()[Symbol.asyncIterator]();
  await iterator.next();
  await input.close();
  assert.deepEqual(signals, [false, true]);
});

test("interaction state observer is ordered and cannot alter state semantics", () => {
  const states: string[] = [];
  const machine = new VoiceInteractionStateMachine((state) => {
    states.push(state);
    if (state === "TRANSCRIBING") throw new Error("observer failure");
  });
  machine.transition("VERIFYING_SPEAKER");
  machine.transition("TRANSCRIBING");
  machine.transition("UNDERSTANDING");
  machine.finish("ERROR");
  assert.deepEqual(states, ["START", "VERIFYING_SPEAKER", "TRANSCRIBING", "UNDERSTANDING", "ERROR"]);
  assert.equal(machine.state, "ERROR");
});

test("loads bounded one-shot live voice configuration", () => {
  assert.deepEqual(loadLiveVoiceConfiguration({}), {
    ownerProfileId: "owner-primary",
    microphoneExecutable: "/opt/homebrew/bin/ffmpeg",
    microphoneDeviceIndex: 0,
    captureTimeoutMilliseconds: 15_000,
    maximumDurationSeconds: 30,
    speechThreshold: 0.015,
    endSilenceMilliseconds: 500,
    preRollMilliseconds: 300
  });
  assert.throws(
    () => loadLiveVoiceConfiguration({ JARVIS_MICROPHONE_FFMPEG: "/tmp/ffmpeg" }),
    hasCode("AUDIO_INPUT_FAILURE")
  );
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof JarvisError && error.code === code;
}
