import assert from "node:assert/strict";
import test from "node:test";
import type { AudioData } from "../../src/audio/contracts.js";
import {
  VoiceInteractionService,
  type ActionExecutorPort,
  type SpeakerVerificationPort
} from "../../src/interaction/index.js";
import { DeterministicIntentRouter, type IntentRouter } from "../../src/intents/index.js";
import type {
  SpeechToTextServiceContract,
  TranscriptResult,
  TranscriptionOptions
} from "../../src/stt/contracts.js";
import type { ToolExecutionResult } from "../../src/tools/contracts.js";
import type {
  SpeechPlaybackOptions,
  SpeechPlaybackResult,
  SpeechRequest,
  TextToSpeechServiceContract
} from "../../src/tts/contracts.js";
import type {
  SpeakerVerificationResult,
  SpeakerVerificationStatus
} from "../../src/voiceid/contracts.js";

const AUDIO: AudioData = {
  sampleRate: 16_000,
  channels: 1,
  format: "pcm-f32",
  samples: new Float32Array([0.1, -0.1]),
  durationSeconds: 2 / 16_000
};

const BATTERY_SUCCESS: ToolExecutionResult = {
  status: "SUCCESS",
  intent: "GET_BATTERY",
  verified: true,
  data: { percentage: 25, powerSource: "AC" }
};

class FakeSpeakerRecognition implements SpeakerVerificationPort {
  calls = 0;
  signal: AbortSignal | undefined;
  readonly #status: SpeakerVerificationStatus;

  constructor(status: SpeakerVerificationStatus = "AUTHORIZED") {
    this.#status = status;
  }

  async verifySpeaker(
    audio: AudioData,
    profileId: string,
    signal?: AbortSignal
  ): Promise<SpeakerVerificationResult> {
    this.calls += 1;
    this.signal = signal;
    assert.equal(audio, AUDIO);
    assert.equal(profileId, "owner-main");
    return verification(this.#status);
  }
}

class FakeSTT implements SpeechToTextServiceContract {
  calls = 0;
  signal: AbortSignal | undefined;
  readonly #result: TranscriptResult;

  constructor(result: TranscriptResult = transcript("Какой заряд батареи?")) {
    this.#result = result;
  }

  async transcribe(
    audio: AudioData,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptResult> {
    this.calls += 1;
    this.signal = options.signal;
    assert.equal(audio, AUDIO);
    return this.#result;
  }
}

class FakeExecutor implements ActionExecutorPort {
  calls = 0;
  signal: AbortSignal | undefined;
  readonly #result: ToolExecutionResult;

  constructor(result: ToolExecutionResult = BATTERY_SUCCESS) {
    this.#result = result;
  }

  async execute(
    command: Parameters<ActionExecutorPort["execute"]>[0],
    signal?: AbortSignal
  ): Promise<ToolExecutionResult> {
    this.calls += 1;
    this.signal = signal;
    assert.equal(command.intent, this.#result.intent);
    return this.#result;
  }
}

class FakeTTS implements TextToSpeechServiceContract {
  readonly requests: SpeechRequest[] = [];
  signal: AbortSignal | undefined;

  async speak(
    request: SpeechRequest,
    options: SpeechPlaybackOptions = {}
  ): Promise<SpeechPlaybackResult> {
    this.requests.push(request);
    this.signal = options.signal;
    return playback(request.text.length);
  }
}

function service(options: {
  speaker?: SpeakerVerificationPort;
  stt?: SpeechToTextServiceContract;
  router?: IntentRouter;
  executor?: ActionExecutorPort;
  tts?: TextToSpeechServiceContract;
} = {}): VoiceInteractionService {
  return new VoiceInteractionService({
    speakerRecognition: options.speaker ?? new FakeSpeakerRecognition(),
    speechToText: options.stt ?? new FakeSTT(),
    intentRouter: options.router ?? new DeterministicIntentRouter(),
    actionExecutor: options.executor ?? new FakeExecutor(),
    textToSpeech: options.tts ?? new FakeTTS()
  });
}

function transcript(
  text: string,
  status: TranscriptResult["status"] = "SUCCESS"
): TranscriptResult {
  return {
    status,
    text,
    language: "ru",
    confidence: status === "SUCCESS" ? 1 : 0,
    durationSeconds: AUDIO.durationSeconds,
    transcriptionLatencyMs: 1,
    backendMetadata: { backend: "fake", model: "fake" }
  };
}

function verification(status: SpeakerVerificationStatus): SpeakerVerificationResult {
  return {
    status,
    similarity: status === "AUTHORIZED" ? 0.9 : status === "UNAUTHORIZED" ? 0.1 : 0.5,
    metadata: {
      profileId: "owner-main",
      referencesCompared: 3,
      modelIdentifier: "fake",
      modelRevision: "fake",
      embeddingLatencyMs: 1,
      verificationLatencyMs: 2,
      decisionPolicyId: "fake-policy",
      calibrationRequired: true
    }
  };
}

function playback(characterCount: number): SpeechPlaybackResult {
  return {
    status: "COMPLETED",
    characterCount,
    playbackLatencyMs: 1,
    backendMetadata: { backend: "fake", voice: "fake", rateWordsPerMinute: 180 }
  };
}

test("authorized battery interaction executes, verifies, responds, and propagates one signal", async () => {
  const controller = new AbortController();
  const speaker = new FakeSpeakerRecognition();
  const stt = new FakeSTT();
  const executor = new FakeExecutor();
  const tts = new FakeTTS();
  const result = await service({ speaker, stt, executor, tts }).run({
    audio: AUDIO,
    ownerProfileId: "owner-main",
    signal: controller.signal
  });

  assert.equal(result.state, "COMPLETE");
  assert.deepEqual(result.transitions, [
    "START",
    "VERIFYING_SPEAKER",
    "TRANSCRIBING",
    "UNDERSTANDING",
    "EXECUTING",
    "RESPONDING",
    "COMPLETE"
  ]);
  assert.equal(result.responseText, "Заряд батареи 25 процентов. Питание от сети.");
  assert.equal(speaker.signal, controller.signal);
  assert.equal(stt.signal, controller.signal);
  assert.equal(executor.signal, controller.signal);
  assert.equal(tts.signal, controller.signal);
  assert.deepEqual(tts.requests, [
    { text: "Заряд батареи 25 процентов. Питание от сети.", language: "RU" }
  ]);
});

test("authorized application interaction returns the deterministic verified response", async () => {
  const execution: ToolExecutionResult = {
    status: "SUCCESS",
    intent: "OPEN_APPLICATION",
    verified: true,
    data: { application: "Safari", running: true }
  };
  const result = await service({
    stt: new FakeSTT(transcript("Открой Safari")),
    executor: new FakeExecutor(execution)
  }).run({ audio: AUDIO, ownerProfileId: "owner-main" });
  assert.equal(result.state, "COMPLETE");
  assert.equal(result.responseText, "Safari открыт.");
});

test("identity rejection and uncertainty fail closed before STT, tools, or routing", async () => {
  for (const [identity, terminal, response] of [
    ["UNAUTHORIZED", "UNAUTHORIZED", "Я не могу подтвердить голос владельца."],
    ["UNCERTAIN", "UNCERTAIN_IDENTITY", "Я не уверен, что это голос владельца."]
  ] as const) {
    const stt = new FakeSTT();
    const executor = new FakeExecutor();
    let routeCalls = 0;
    const router: IntentRouter = {
      route() {
        routeCalls += 1;
        return { status: "NO_MATCH", command: null };
      }
    };
    const tts = new FakeTTS();
    const result = await service({
      speaker: new FakeSpeakerRecognition(identity),
      stt,
      router,
      executor,
      tts
    }).run({ audio: AUDIO, ownerProfileId: "owner-main" });
    assert.equal(result.state, terminal);
    assert.equal(result.responseText, response);
    assert.equal(stt.calls, 0);
    assert.equal(routeCalls, 0);
    assert.equal(executor.calls, 0);
    assert.equal(tts.requests.length, 1);
  }
});

test("empty, uncertain, and unmatched speech never reaches tool execution", async () => {
  for (const [sttResult, terminal] of [
    [transcript("", "EMPTY"), "NO_SPEECH"],
    [transcript("неразборчиво", "UNCERTAIN"), "UNCERTAIN_SPEECH"],
    [transcript("Расскажи анекдот"), "NO_MATCH"]
  ] as const) {
    const executor = new FakeExecutor();
    const result = await service({ stt: new FakeSTT(sttResult), executor }).run({
      audio: AUDIO,
      ownerProfileId: "owner-main"
    });
    assert.equal(result.state, terminal);
    assert.equal(executor.calls, 0);
    assert.equal(result.execution, null);
  }
});

test("verified tool failure is reported without claiming successful completion", async () => {
  const result = await service({
    executor: new FakeExecutor({
      status: "FAILED",
      intent: "GET_BATTERY",
      verified: false,
      data: null
    })
  }).run({ audio: AUDIO, ownerProfileId: "owner-main" });
  assert.equal(result.state, "ERROR");
  assert.equal(result.responseText, "Не удалось выполнить команду.");
  assert.equal(result.errorCode, "TOOL_EXECUTION_FAILED");
});

test("thrown tool failures receive a safe spoken error without leaking backend details", async () => {
  const executor: ActionExecutorPort = {
    async execute() {
      throw new Error("/private/user/path token=sensitive");
    }
  };
  const tts = new FakeTTS();
  const result = await service({ executor, tts }).run({
    audio: AUDIO,
    ownerProfileId: "owner-main"
  });
  assert.equal(result.state, "ERROR");
  assert.equal(result.responseText, "Не удалось выполнить команду.");
  assert.equal(result.execution, null);
  assert.equal(result.errorCode, "TOOL_EXECUTION_FAILED");
  assert.deepEqual(tts.requests, [
    { text: "Не удалось выполнить команду.", language: "RU" }
  ]);
  assert.equal(JSON.stringify(result).includes("sensitive"), false);
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("a pre-aborted interaction performs no identity, STT, tool, or TTS work", async () => {
  const controller = new AbortController();
  controller.abort();
  const speaker = new FakeSpeakerRecognition();
  const stt = new FakeSTT();
  const executor = new FakeExecutor();
  const tts = new FakeTTS();
  const result = await service({ speaker, stt, executor, tts }).run({
    audio: AUDIO,
    ownerProfileId: "owner-main",
    signal: controller.signal
  });
  assert.equal(result.state, "CANCELLED");
  assert.deepEqual(result.transitions, ["START", "CANCELLED"]);
  assert.equal(speaker.calls, 0);
  assert.equal(stt.calls, 0);
  assert.equal(executor.calls, 0);
  assert.equal(tts.requests.length, 0);
});

test("external cancellation stops an active downstream stage and prevents later work", async () => {
  const controller = new AbortController();
  const executor = new FakeExecutor();
  const tts = new FakeTTS();
  let receivedSignal: AbortSignal | undefined;
  const stt: SpeechToTextServiceContract = {
    transcribe(_audio, options = {}) {
      receivedSignal = options.signal;
      return new Promise<TranscriptResult>(() => undefined);
    }
  };
  const pending = service({ stt, executor, tts }).run({
    audio: AUDIO,
    ownerProfileId: "owner-main",
    signal: controller.signal
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  const result = await pending;
  assert.equal(receivedSignal, controller.signal);
  assert.equal(result.state, "CANCELLED");
  assert.equal(executor.calls, 0);
  assert.equal(tts.requests.length, 0);
});

test("external cancellation stops active identity verification before downstream work", async () => {
  const controller = new AbortController();
  const stt = new FakeSTT();
  const executor = new FakeExecutor();
  let receivedSignal: AbortSignal | undefined;
  const speaker: SpeakerVerificationPort = {
    verifySpeaker(_audio, _profileId, signal) {
      receivedSignal = signal;
      return new Promise<SpeakerVerificationResult>(() => undefined);
    }
  };
  const pending = service({ speaker, stt, executor }).run({
    audio: AUDIO,
    ownerProfileId: "owner-main",
    signal: controller.signal
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  const result = await pending;
  assert.equal(receivedSignal, controller.signal);
  assert.equal(result.state, "CANCELLED");
  assert.equal(stt.calls, 0);
  assert.equal(executor.calls, 0);
});

test("external cancellation stops active tool execution before response playback", async () => {
  const controller = new AbortController();
  const tts = new FakeTTS();
  let receivedSignal: AbortSignal | undefined;
  const executor: ActionExecutorPort = {
    execute(_command, signal) {
      receivedSignal = signal;
      return new Promise<ToolExecutionResult>(() => undefined);
    }
  };
  const pending = service({ executor, tts }).run({
    audio: AUDIO,
    ownerProfileId: "owner-main",
    signal: controller.signal
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  const result = await pending;
  assert.equal(receivedSignal, controller.signal);
  assert.equal(result.state, "CANCELLED");
  assert.equal(result.execution, null);
  assert.equal(tts.requests.length, 0);
});

test("cancellation during TTS preserves the already verified tool result", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const tts: TextToSpeechServiceContract = {
    speak(_request, options = {}) {
      receivedSignal = options.signal;
      return new Promise<SpeechPlaybackResult>(() => undefined);
    }
  };
  const pending = service({ tts }).run({
    audio: AUDIO,
    ownerProfileId: "owner-main",
    signal: controller.signal
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  const result = await pending;
  assert.equal(receivedSignal, controller.signal);
  assert.equal(result.state, "CANCELLED");
  assert.equal(result.responseText, "Заряд батареи 25 процентов. Питание от сети.");
  assert.deepEqual(result.execution, BATTERY_SUCCESS);
  assert.equal(result.playback, null);
});

test("unexpected backend details are not exposed by the structured error result", async () => {
  const speaker: SpeakerVerificationPort = {
    async verifySpeaker() {
      throw new Error("/private/user/path token=sensitive waveform=[0.1,-0.1]");
    }
  };
  const result = await service({ speaker }).run({ audio: AUDIO, ownerProfileId: "owner-main" });
  assert.deepEqual(result, {
    state: "ERROR",
    transitions: ["START", "VERIFYING_SPEAKER", "ERROR"],
    responseText: null,
    playback: null,
    execution: null,
    errorCode: "INTERACTION_FAILED"
  });
  assert.equal(JSON.stringify(result).includes("sensitive"), false);
  assert.equal(JSON.stringify(result).includes("waveform"), false);
});
