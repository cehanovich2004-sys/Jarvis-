import assert from "node:assert/strict";
import test from "node:test";
import {
  TextToSpeechAdapter,
  TextToSpeechService,
  type TTSRuntimeClient
} from "../../src/tts/index.js";

test("structured response text flows through the isolated cancellable TTS boundary", async () => {
  const responseText = "Батарея — 73 процента.";
  const spoken: string[] = [];
  const runtime: TTSRuntimeClient = {
    metadata: { backend: "deterministic-local", voice: "ci-fixture", rateWordsPerMinute: 180 },
    async speak(input, signal) {
      assert.equal(signal?.aborted, false);
      spoken.push(input.text);
      return { status: "COMPLETED" };
    }
  };
  const service = new TextToSpeechService(new TextToSpeechAdapter(runtime));
  const result = await service.speak({ text: responseText, language: "RU" });

  assert.deepEqual(spoken, [responseText]);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.characterCount, responseText.length);
  assert.equal(result.backendMetadata.backend, "deterministic-local");
});
