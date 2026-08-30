#!/usr/bin/env node
import type { AudioData } from "../audio/index.js";
import { JarvisError } from "../errors.js";
import { createLocalTextToSpeechService } from "../tts/index.js";
import { createRealVoiceIDComponents } from "../voiceid/index.js";
import { loadLiveVoiceConfiguration } from "./config.js";
import { createMacOSMicrophoneDiagnostic } from "./factory.js";

const SAMPLE_COUNT = 3;
const controller = new AbortController();
const cancel = (): void => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);

const voiceId = createRealVoiceIDComponents(process.env, { enrollmentOnly: true });
const speech = createLocalTextToSpeechService();
try {
  const profileId = loadLiveVoiceConfiguration().ownerProfileId;
  if (process.argv.includes("--delete")) {
    const deleted = await voiceId.profiles.delete(profileId);
    console.log(deleted ? "Owner voice profile deleted." : "Owner voice profile was not present.");
  } else {
    const samples: AudioData[] = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      await speech.speak(
        { text: enrollmentPrompt(index), language: "RU" },
        { signal: controller.signal }
      );
      console.log(`ENROLLMENT SAMPLE ${index + 1}/${SAMPLE_COUNT}: speak naturally after LISTENING.`);
      console.log("LISTENING");
      const captured = await createMacOSMicrophoneDiagnostic().run(controller.signal);
      if (captured.state !== "COMPLETE") {
        throw new JarvisError(
          "SPEAKER_INVALID_AUDIO",
          422,
          captured.state === "CANCELLED" ? "Owner enrollment was cancelled." : "No usable speech was captured."
        );
      }
      samples.push(captured.audio);
      console.log(`CAPTURED ${captured.audio.durationSeconds.toFixed(2)}s`);
    }
    console.log("EXTRACTING VOICE PROFILE");
    const summary = await voiceId.service.enrollOwner(profileId, samples, controller.signal);
    samples.splice(0, samples.length);
    console.log(`ENROLLED ${summary.referenceCount} references for ${summary.profileId}.`);
    console.log("Raw enrollment audio discarded. Profile contains embeddings only.");
    console.log("Calibration status: REQUIRED. No production threshold was selected.");
    await speech.speak(
      { text: "Голосовой профиль владельца создан.", language: "RU" },
      { signal: controller.signal }
    );
  }
} catch (error) {
  const safe = error instanceof JarvisError
    ? error
    : new JarvisError("INTERNAL_ERROR", 500, "Owner enrollment failed.");
  console.error(`${safe.code}: ${safe.message}`);
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally {
  await voiceId.close();
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}

function enrollmentPrompt(index: number): string {
  const labels = ["Первая", "Вторая", "Третья"] as const;
  return `${labels[index] ?? "Следующая"} фраза. Говорите после сигнала.`;
}
