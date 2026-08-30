import assert from "node:assert/strict";
import test from "node:test";
import type { AudioData } from "../../src/audio/contracts.js";
import { VoiceInteractionService } from "../../src/interaction/service.js";
import { DeterministicIntentRouter } from "../../src/intents/router.js";
import {
  DeterministicPersonalityEngine,
  PersonalityInteractionResponseGenerator
} from "../../src/personality/index.js";
import type { SpeechPlaybackResult, SpeechRequest } from "../../src/tts/contracts.js";

const audio: AudioData = {
  sampleRate: 16_000, channels: 1, format: "pcm-f32",
  samples: new Float32Array([0.1]), durationSeconds: 1 / 16_000
};

test("J7 can present an immutable verified fact through J10 and TTS without changing execution", async () => {
  const spoken: SpeechRequest[] = [];
  const execution = {
    status: "SUCCESS" as const,
    intent: "GET_BATTERY" as const,
    verified: true as const,
    data: { percentage: 25, powerSource: "AC" as const }
  };
  const service = new VoiceInteractionService(
    {
      speakerRecognition: {
        async verifySpeaker() {
          return {
            status: "AUTHORIZED", similarity: 0.9,
            metadata: {
              profileId: "owner", referencesCompared: 2, modelIdentifier: "fake",
              modelRevision: "fake", embeddingLatencyMs: 1, verificationLatencyMs: 1,
              decisionPolicyId: "fake", calibrationRequired: true
            }
          };
        }
      },
      speechToText: {
        async transcribe() {
          return {
            status: "SUCCESS", text: "Какой заряд?", durationSeconds: 1,
            transcriptionLatencyMs: 1, backendMetadata: { backend: "fake", model: "fake" }
          };
        }
      },
      intentRouter: new DeterministicIntentRouter(),
      actionExecutor: { async execute() { return execution; } },
      textToSpeech: {
        async speak(request): Promise<SpeechPlaybackResult> {
          spoken.push(request);
          return {
            status: "COMPLETED", characterCount: request.text.length, playbackLatencyMs: 1,
            backendMetadata: { backend: "fake", voice: "fake", rateWordsPerMinute: 180 }
          };
        }
      }
    },
    new PersonalityInteractionResponseGenerator(
      new DeterministicPersonalityEngine(), 3, 19
    )
  );
  const result = await service.run({ audio, ownerProfileId: "owner" });
  assert.equal(result.state, "COMPLETE");
  assert.deepEqual(result.execution, execution);
  assert.match(result.responseText, /25/u);
  assert.match(result.responseText, /Питание от сети/u);
  assert.deepEqual(spoken, [{ text: result.responseText, language: "RU" }]);
});

test("security denial remains neutral even with maximum humor", () => {
  const generator = new PersonalityInteractionResponseGenerator(
    new DeterministicPersonalityEngine(), 3, 19
  );
  assert.equal(
    generator.forAlternateState("UNAUTHORIZED"),
    "Я не могу подтвердить голос владельца."
  );
});
