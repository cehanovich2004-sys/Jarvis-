import assert from "node:assert/strict";
import test from "node:test";
import {
  AudioSession,
  RecordedAudioInput,
  type AudioChunk,
  type MicrophoneInput,
  type VoiceActivity,
  type VoiceActivityDetector
} from "../../src/audio/index.js";
import { JarvisError } from "../../src/errors.js";
import { DeterministicIntentRouter } from "../../src/intents/index.js";
import {
  VoiceInteractionCoordinator,
  VoiceInteractionService,
  type ActionExecutorPort,
  type SpeakerVerificationPort
} from "../../src/interaction/index.js";
import { LiveVoiceMode } from "../../src/live-voice/index.js";
import type { SpeechToTextServiceContract, TranscriptResult } from "../../src/stt/index.js";
import type { ToolExecutionResult } from "../../src/tools/index.js";
import type {
  SpeechPlaybackResult,
  SpeechRequest,
  TextToSpeechServiceContract
} from "../../src/tts/index.js";
import type { SpeakerVerificationResult, SpeakerVerificationStatus } from "../../src/voiceid/index.js";

class SequenceVad implements VoiceActivityDetector {
  readonly #states: VoiceActivity[];
  constructor(states: VoiceActivity[]) { this.#states = [...states]; }
  async process(): Promise<VoiceActivity> { return this.#states.shift() ?? "SILENCE"; }
  reset(): void {}
}

class HangingInput implements MicrophoneInput {
  closed = false;
  async *chunks(signal?: AbortSignal): AsyncIterable<AudioChunk> {
    await new Promise<void>((resolve) => {
      if (signal?.aborted === true) return resolve();
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  }
  async close(): Promise<void> { this.closed = true; }
}

class FailingInput implements MicrophoneInput {
  closed = false;
  async *chunks(): AsyncIterable<AudioChunk> { throw new Error("private microphone detail"); }
  async close(): Promise<void> { this.closed = true; }
}

class FakeSpeaker implements SpeakerVerificationPort {
  calls = 0;
  readonly #status: SpeakerVerificationStatus;
  constructor(status: SpeakerVerificationStatus = "AUTHORIZED") { this.#status = status; }
  async verifySpeaker(): Promise<SpeakerVerificationResult> {
    this.calls += 1;
    return {
      status: this.#status,
      similarity: this.#status === "AUTHORIZED" ? 0.9 : this.#status === "UNAUTHORIZED" ? 0.1 : 0.5,
      metadata: {
        profileId: "owner-main",
        referencesCompared: 3,
        modelIdentifier: "fake",
        modelRevision: "fake",
        embeddingLatencyMs: 1,
        verificationLatencyMs: 1,
        decisionPolicyId: "fake-calibration",
        calibrationRequired: true
      }
    };
  }
}

class FakeSTT implements SpeechToTextServiceContract {
  calls = 0;
  readonly #result: TranscriptResult | JarvisError;
  constructor(result: TranscriptResult | JarvisError = transcript("Какой заряд батареи?")) {
    this.#result = result;
  }
  async transcribe(): Promise<TranscriptResult> {
    this.calls += 1;
    if (this.#result instanceof JarvisError) throw this.#result;
    return this.#result;
  }
}

class FakeExecutor implements ActionExecutorPort {
  calls = 0;
  async execute(): Promise<ToolExecutionResult> {
    this.calls += 1;
    return {
      status: "SUCCESS",
      intent: "GET_BATTERY",
      verified: true,
      data: { percentage: 25, powerSource: "AC" }
    };
  }
}

class FakeTTS implements TextToSpeechServiceContract {
  requests: SpeechRequest[] = [];
  async speak(request: SpeechRequest): Promise<SpeechPlaybackResult> {
    this.requests.push(request);
    return {
      status: "COMPLETED",
      characterCount: request.text.length,
      playbackLatencyMs: 1,
      backendMetadata: { backend: "fake", voice: "fake", rateWordsPerMinute: 180 }
    };
  }
}

function audioChunk(value: number): AudioChunk {
  return {
    sampleRate: 16_000,
    channels: 1,
    format: "pcm-f32",
    samples: new Float32Array([value])
  };
}

function transcript(text: string): TranscriptResult {
  return {
    status: "SUCCESS",
    text,
    language: "ru",
    confidence: 1,
    durationSeconds: 2 / 16_000,
    transcriptionLatencyMs: 1,
    backendMetadata: { backend: "fake", model: "fake" }
  };
}

function live(options: {
  input?: MicrophoneInput;
  vad?: VoiceActivityDetector;
  timeoutMilliseconds?: number;
  speaker?: FakeSpeaker;
  stt?: FakeSTT;
  executor?: FakeExecutor;
  tts?: FakeTTS;
} = {}): { mode: LiveVoiceMode; input: MicrophoneInput; executor: FakeExecutor; stt: FakeSTT } {
  const input = options.input ?? new RecordedAudioInput([
    audioChunk(0), audioChunk(0.2), audioChunk(0.2)
  ]);
  const executor = options.executor ?? new FakeExecutor();
  const stt = options.stt ?? new FakeSTT();
  const service = new VoiceInteractionService({
    speakerRecognition: options.speaker ?? new FakeSpeaker(),
    speechToText: stt,
    intentRouter: new DeterministicIntentRouter(),
    actionExecutor: executor,
    textToSpeech: options.tts ?? new FakeTTS()
  });
  return {
    mode: new LiveVoiceMode(
      () => new AudioSession(
        input,
        options.vad ?? new SequenceVad(["SILENCE", "SPEECH_START", "SPEECH_END"]),
        { timeoutMilliseconds: options.timeoutMilliseconds ?? 1_000 }
      ),
      new VoiceInteractionCoordinator(service),
      "owner-main"
    ),
    input,
    executor,
    stt
  };
}

test("captured utterance traverses identity, STT, routing, verified execution, and TTS", async () => {
  const states: string[] = [];
  const transcripts: string[] = [];
  const identities: string[] = [];
  const { mode, executor, stt } = live();
  const result = await mode.runOneShot({
    onStateChange: (state) => states.push(state),
    onTranscript: (text, language) => transcripts.push(`${language}:${text}`),
    onIdentity: (identity) => identities.push(identity.status)
  });
  assert.equal(result.state, "COMPLETE");
  assert.equal(executor.calls, 1);
  assert.equal(stt.calls, 1);
  assert.deepEqual(states, [
    "LISTENING", "START", "VERIFYING_SPEAKER", "TRANSCRIBING", "UNDERSTANDING",
    "EXECUTING", "RESPONDING", "COMPLETE"
  ]);
  assert.deepEqual(transcripts, ["ru:Какой заряд батареи?"]);
  assert.deepEqual(identities, ["AUTHORIZED"]);
  assert.equal("audio" in result, false);
});

test("silence timeout and cancellation stop capture and release microphone", async () => {
  const timeoutInput = new HangingInput();
  assert.deepEqual(
    await live({ input: timeoutInput, timeoutMilliseconds: 5 }).mode.runOneShot(),
    { state: "NO_SPEECH", audioDurationSeconds: null, interaction: null }
  );
  assert.equal(timeoutInput.closed, true);

  const cancelledInput = new HangingInput();
  const controller = new AbortController();
  const pending = live({ input: cancelledInput }).mode.runOneShot({ signal: controller.signal });
  controller.abort();
  assert.deepEqual(await pending, {
    state: "CANCELLED",
    audioDurationSeconds: null,
    interaction: null
  });
  assert.equal(cancelledInput.closed, true);
});

test("microphone and STT failures are sanitized and cannot leave stale execution", async () => {
  const failedInput = new FailingInput();
  const capture = live({ input: failedInput });
  assert.deepEqual(await capture.mode.runOneShot(), {
    state: "ERROR",
    audioDurationSeconds: null,
    interaction: null,
    errorCode: "AUDIO_INPUT_FAILURE"
  });
  assert.equal(failedInput.closed, true);
  assert.equal(capture.executor.calls, 0);

  const transcription = live({
    stt: new FakeSTT(new JarvisError("STT_MODEL_UNAVAILABLE", 503, "unavailable"))
  });
  const result = await transcription.mode.runOneShot();
  assert.equal(result.state, "ERROR");
  assert.equal(transcription.executor.calls, 0);
});

test("unauthorized and uncertain identities never reach STT or tools", async () => {
  for (const status of ["UNAUTHORIZED", "UNCERTAIN"] as const) {
    const stt = new FakeSTT();
    const executor = new FakeExecutor();
    const result = await live({ speaker: new FakeSpeaker(status), stt, executor }).mode.runOneShot();
    assert.equal(result.state, status === "UNAUTHORIZED" ? "UNAUTHORIZED" : "UNCERTAIN_IDENTITY");
    assert.equal(result.interaction?.state, status === "UNAUTHORIZED" ? "UNAUTHORIZED" : "UNCERTAIN_IDENTITY");
    assert.equal(stt.calls, 0);
    assert.equal(executor.calls, 0);
  }
});

test("a concurrent one-shot run is rejected without starting a second capture", async () => {
  const input = new HangingInput();
  const mode = live({ input }).mode;
  const controller = new AbortController();
  const first = mode.runOneShot({ signal: controller.signal });
  await assert.rejects(mode.runOneShot(), hasCode("LIVE_VOICE_BUSY"));
  controller.abort();
  await first;
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof JarvisError && error.code === code;
}
