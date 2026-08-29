import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AudioSession,
  RecordedAudioInput,
  type AudioChunk,
  type VoiceActivity,
  type VoiceActivityDetector
} from "../../src/audio/index.js";

class IntegrationVad implements VoiceActivityDetector {
  readonly #states: VoiceActivity[] = ["SILENCE", "SPEECH_START", "SPEECH", "SPEECH_END"];

  async process(): Promise<VoiceActivity> {
    return this.#states.shift() ?? "SILENCE";
  }

  reset(): void {}
}

function audioChunk(value: number): AudioChunk {
  return {
    sampleRate: 16_000,
    channels: 1,
    format: "pcm-f32",
    samples: new Float32Array([value])
  };
}

test("recorded audio flows through VAD and session buffering without a microphone", async () => {
  const input = new RecordedAudioInput([
    audioChunk(0),
    audioChunk(0.25),
    audioChunk(0.5),
    audioChunk(0.25)
  ]);
  const session = new AudioSession(input, new IntegrationVad(), { timeoutMilliseconds: 1_000 });

  const result = await session.run();

  assert.equal(result.state, "COMPLETE");
  assert.deepEqual(result.state === "COMPLETE" ? [...result.audio.samples] : [], [0.25, 0.5, 0.25]);
  assert.equal(result.state === "COMPLETE" ? result.audio.durationSeconds : 0, 3 / 16_000);
});
