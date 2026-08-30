import assert from "node:assert/strict";
import test from "node:test";
import type { AudioData } from "../../src/audio/contracts.js";
import {
  VoiceInteractionCoordinator,
  VoiceInteractionService,
  type ActionExecutorPort,
  type SpeakerVerificationPort
} from "../../src/interaction/index.js";
import { DeterministicIntentRouter } from "../../src/intents/index.js";
import type { SpeechToTextServiceContract, TranscriptResult } from "../../src/stt/contracts.js";
import type { ToolExecutionResult } from "../../src/tools/contracts.js";
import type {
  SpeechPlaybackResult,
  TextToSpeechServiceContract
} from "../../src/tts/contracts.js";
import type { SpeakerVerificationResult } from "../../src/voiceid/contracts.js";

const AUDIO: AudioData = {
  sampleRate: 16_000,
  channels: 1,
  format: "pcm-f32",
  samples: new Float32Array([0.1]),
  durationSeconds: 1 / 16_000
};

const EXECUTION: ToolExecutionResult = {
  status: "SUCCESS",
  intent: "GET_BATTERY",
  verified: true,
  data: { percentage: 25, powerSource: "AC" }
};

test("barge-in stops TTS, preserves the completed action, and re-runs every gate", async () => {
  let identityCalls = 0;
  let sttCalls = 0;
  let toolCalls = 0;
  const playbackSignals: AbortSignal[] = [];
  const coordinator = createCoordinator({
    speaker: {
      async verifySpeaker() {
        identityCalls += 1;
        return verification("AUTHORIZED");
      }
    },
    stt: {
      async transcribe() {
        sttCalls += 1;
        return transcript();
      }
    },
    executor: {
      async execute() {
        toolCalls += 1;
        return EXECUTION;
      }
    },
    tts: {
      speak(request, options = {}) {
        const signal = requiredSignal(options.signal);
        playbackSignals.push(signal);
        if (playbackSignals.length > 1) return Promise.resolve(playback(request.text.length));
        return rejectOnAbort(signal);
      }
    }
  });

  const first = coordinator.start(request("turn-1"));
  await until(() => playbackSignals.length === 1);
  const second = coordinator.start(request("turn-2"));
  const firstResult = await first;
  const secondResult = await second;

  assert.equal(firstResult.state, "INTERRUPTED");
  assert.equal(firstResult.transitions.at(-1), "INTERRUPTED");
  assert.deepEqual(firstResult.execution, EXECUTION);
  assert.equal(firstResult.playback, null);
  assert.equal(playbackSignals[0]?.aborted, true);
  assert.equal(secondResult.state, "COMPLETE");
  assert.equal(identityCalls, 2);
  assert.equal(sttCalls, 2);
  assert.equal(toolCalls, 2);
  assert.equal(coordinator.activeInteractionId, null);
});

test("stale STT completion after interruption cannot execute old work", async () => {
  const stale = deferred<TranscriptResult>();
  let sttCalls = 0;
  let toolCalls = 0;
  const coordinator = createCoordinator({
    stt: {
      transcribe() {
        sttCalls += 1;
        return sttCalls === 1 ? stale.promise : Promise.resolve(transcript());
      }
    },
    executor: {
      async execute() {
        toolCalls += 1;
        return EXECUTION;
      }
    }
  });
  const first = coordinator.start(request("stale-1"));
  await until(() => sttCalls === 1);
  const second = coordinator.start(request("stale-2"));
  assert.equal((await first).state, "INTERRUPTED");
  assert.equal((await second).state, "COMPLETE");
  stale.resolve(transcript());
  await tick();
  assert.equal(toolCalls, 1);
});

test("rapid repeated interruption has deterministic latest-owner handoff", async () => {
  const firstIdentity = deferred<SpeakerVerificationResult>();
  let identityCalls = 0;
  const coordinator = createCoordinator({
    speaker: {
      verifySpeaker() {
        identityCalls += 1;
        return identityCalls === 1
          ? firstIdentity.promise
          : Promise.resolve(verification("AUTHORIZED"));
      }
    }
  });
  const first = coordinator.start(request("rapid-a"));
  await until(() => identityCalls === 1);
  const second = coordinator.start(request("rapid-b"));
  const third = coordinator.start(request("rapid-c"));
  assert.equal((await first).state, "INTERRUPTED");
  assert.equal((await second).state, "INTERRUPTED");
  assert.equal((await third).state, "COMPLETE");
  assert.equal(identityCalls, 2);
  firstIdentity.resolve(verification("AUTHORIZED"));
  await tick();
  assert.equal(identityCalls, 2);
});

test("new interaction cannot inherit authorization or permission from interrupted turn", async () => {
  let identityCalls = 0;
  let sttCalls = 0;
  let toolCalls = 0;
  let firstPlaybackSignal: AbortSignal | undefined;
  const coordinator = createCoordinator({
    speaker: {
      async verifySpeaker() {
        identityCalls += 1;
        return verification(identityCalls === 1 ? "AUTHORIZED" : "UNAUTHORIZED");
      }
    },
    stt: {
      async transcribe() {
        sttCalls += 1;
        return transcript();
      }
    },
    executor: {
      async execute() {
        toolCalls += 1;
        return EXECUTION;
      }
    },
    tts: {
      speak(request, options = {}) {
        const signal = requiredSignal(options.signal);
        if (firstPlaybackSignal === undefined) {
          firstPlaybackSignal = signal;
          return rejectOnAbort(signal);
        }
        return Promise.resolve(playback(request.text.length));
      }
    }
  });
  const first = coordinator.start(request("permission-1"));
  await until(() => firstPlaybackSignal !== undefined);
  const second = coordinator.start(request("permission-2"));
  assert.equal((await first).state, "INTERRUPTED");
  assert.equal((await second).state, "UNAUTHORIZED");
  assert.equal(identityCalls, 2);
  assert.equal(sttCalls, 1);
  assert.equal(toolCalls, 1);
});

test("exclusive guard holds a running stale tool before allowing the next tool", async () => {
  const staleTool = deferred<ToolExecutionResult>();
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  const delegate: ActionExecutorPort = {
    async execute() {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (calls === 1) await staleTool.promise;
      active -= 1;
      return EXECUTION;
    }
  };
  const coordinator = createCoordinator({ executor: delegate });
  const first = coordinator.start(request("tool-1"));
  await until(() => calls === 1);
  const second = coordinator.start(request("tool-2"));
  assert.equal((await first).state, "INTERRUPTED");
  await tick();
  assert.equal(calls, 1);
  staleTool.resolve(EXECUTION);
  assert.equal((await second).state, "COMPLETE");
  assert.equal(calls, 2);
  assert.equal(maximumActive, 1);
});

test("completion wins deterministically when playback settles before interruption", async () => {
  const coordinator = createCoordinator();
  const result = await coordinator.start(request("already-complete"));
  assert.equal(result.state, "COMPLETE");
  assert.equal(coordinator.interruptActive(), false);
});

test("external cancellation remains CANCELLED rather than becoming a barge-in", async () => {
  const controller = new AbortController();
  const pendingIdentity = deferred<SpeakerVerificationResult>();
  const coordinator = createCoordinator({
    speaker: {
      verifySpeaker() { return pendingIdentity.promise; }
    }
  });
  const result = coordinator.start({ ...request("external-cancel"), signal: controller.signal });
  controller.abort(new Error("caller cancelled"));
  assert.equal((await result).state, "CANCELLED");
  pendingIdentity.resolve(verification("AUTHORIZED"));
});

function createCoordinator(overrides: {
  speaker?: SpeakerVerificationPort;
  stt?: SpeechToTextServiceContract;
  executor?: ActionExecutorPort;
  tts?: TextToSpeechServiceContract;
} = {}): VoiceInteractionCoordinator {
  const service = new VoiceInteractionService({
    speakerRecognition: overrides.speaker ?? {
      async verifySpeaker() { return verification("AUTHORIZED"); }
    },
    speechToText: overrides.stt ?? {
      async transcribe() { return transcript(); }
    },
    intentRouter: new DeterministicIntentRouter(),
    actionExecutor: overrides.executor ?? {
      async execute() { return EXECUTION; }
    },
    textToSpeech: overrides.tts ?? {
      async speak(request) { return playback(request.text.length); }
    }
  });
  return new VoiceInteractionCoordinator(service);
}

function request(interactionId: string) {
  return { interactionId, audio: AUDIO, ownerProfileId: "owner-main" };
}

function verification(status: "AUTHORIZED" | "UNAUTHORIZED"): SpeakerVerificationResult {
  return {
    status,
    similarity: status === "AUTHORIZED" ? 0.9 : 0.1,
    metadata: {
      profileId: "owner-main",
      referencesCompared: 3,
      modelIdentifier: "fake",
      modelRevision: "fake",
      embeddingLatencyMs: 1,
      verificationLatencyMs: 1,
      decisionPolicyId: "fake",
      calibrationRequired: true
    }
  };
}

function transcript(): TranscriptResult {
  return {
    status: "SUCCESS",
    text: "Какой заряд батареи?",
    language: "ru",
    confidence: 1,
    durationSeconds: AUDIO.durationSeconds,
    transcriptionLatencyMs: 1,
    backendMetadata: { backend: "fake", model: "fake" }
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

function rejectOnAbort(signal: AbortSignal): Promise<SpeechPlaybackResult> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

function requiredSignal(signal: AbortSignal | undefined): AbortSignal {
  assert.notEqual(signal, undefined);
  return signal as AbortSignal;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await tick();
  }
  assert.fail("Timed out waiting for asynchronous test condition.");
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
