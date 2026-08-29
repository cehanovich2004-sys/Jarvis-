import assert from "node:assert/strict";
import test from "node:test";
import type { AudioData } from "../../src/audio/contracts.js";
import {
  SpeechToTextAdapter,
  SpeechToTextService,
  type STTAudioInput,
  type STTRuntimeClient,
  type STTRuntimeResult
} from "../../src/stt/index.js";

class DeterministicSTTRuntime implements STTRuntimeClient {
  readonly metadata = { backend: "deterministic-local", model: "ci-fixture" };

  async transcribe(input: STTAudioInput): Promise<STTRuntimeResult> {
    assert.equal(input.sampleRateHz, 16_000);
    assert.equal(input.channels, 1);
    assert.equal(input.format, "pcm-f32");
    assert.equal(input.languageMode, "AUTO");
    return {
      status: "SUCCESS",
      text: "Джарвис, открой GitHub",
      language: "ru",
      confidence: 0.9
    };
  }
}

test("completed AudioData flows through the isolated STT boundary", async () => {
  const samples = new Float32Array(1_600).fill(0.1);
  const audio: AudioData = {
    sampleRate: 16_000,
    channels: 1,
    format: "pcm-f32",
    samples,
    durationSeconds: 0.1
  };
  const service = new SpeechToTextService(
    new SpeechToTextAdapter(new DeterministicSTTRuntime())
  );
  const result = await service.transcribe(audio);

  assert.equal(result.status, "SUCCESS");
  assert.equal(result.text, "Джарвис, открой GitHub");
  assert.equal(result.language, "ru");
  assert.equal(result.durationSeconds, 0.1);
  assert.equal(result.backendMetadata.backend, "deterministic-local");
});
