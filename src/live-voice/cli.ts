#!/usr/bin/env node
import { JarvisError } from "../errors.js";
import { createConfiguredWhisperServer } from "../stt/index.js";
import { createLocalTextToSpeechService } from "../tts/index.js";
import { createMacOSMicrophoneDiagnostic, createRealMacOSLiveVoiceMode } from "./factory.js";
import type { LiveVoiceState } from "./contracts.js";

const controller = new AbortController();
const cancel = (): void => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);

try {
  if (process.argv.includes("--microphone-smoke")) {
    console.log("LISTENING");
    const result = await createMacOSMicrophoneDiagnostic().run(controller.signal);
    if (result.state === "COMPLETE") {
      console.log(`CAPTURED ${result.audio.durationSeconds.toFixed(2)}s`);
      console.log("Raw audio discarded.");
    } else {
      console.log(result.state === "TIMEOUT" ? "NO_SPEECH" : "CANCELLED");
      process.exitCode = result.state === "TIMEOUT" ? 2 : 130;
    }
  } else {
    const whisper = createConfiguredWhisperServer();
    let live: ReturnType<typeof createRealMacOSLiveVoiceMode> | undefined;
    try {
      console.log("STARTING_STT");
      await whisper.start(controller.signal);
      live = createRealMacOSLiveVoiceMode();
      console.log("WARMING_VOICEID");
      const voiceIdWarmupStartedAt = performance.now();
      await live.voiceId.runtime.warmup(controller.signal);
      console.log(`VOICEID_WARMUP_MS ${(performance.now() - voiceIdWarmupStartedAt).toFixed(1)}`);
      await createLocalTextToSpeechService().speak(
        { text: "Слушаю.", language: "RU" },
        { signal: controller.signal }
      );
      const startedAt = performance.now();
      const stageStartedAt = new Map<LiveVoiceState, number>();
      const activityStartedAt = new Map<import("../audio/contracts.js").VoiceActivity, number>();
      const result = await live.mode.runOneShot({
        signal: controller.signal,
        onStateChange: (state) => {
          stageStartedAt.set(state, performance.now());
          console.log(state);
        },
        onVoiceActivity: (activity) => {
          if (activity === "SPEECH") {
            activityStartedAt.delete("TRAILING_SILENCE");
          } else if (!activityStartedAt.has(activity)) {
            activityStartedAt.set(activity, performance.now());
          }
        },
        ...(process.env.JARVIS_VOICE_SHOW_TRANSCRIPT === "1"
          ? { onTranscript: (text: string, language?: string) =>
              console.log(`TRANSCRIPT ${language ?? "unknown"} ${text}`) }
          : {}),
        ...(process.env.JARVIS_VOICE_SHOW_IDENTITY_SCORE === "1"
          ? { onIdentity: (identity: import("../voiceid/contracts.js").SpeakerVerificationResult) =>
              console.log(
                `IDENTITY ${identity.status} similarity=${identity.similarity.toFixed(6)} ` +
                `policy=${identity.metadata.decisionPolicyId} calibrationRequired=${identity.metadata.calibrationRequired}`
              ) }
          : {})
      });
      console.log(`RESULT ${result.state}`);
      if (result.state === "ERROR") {
        console.log(`ERROR_CODE ${result.errorCode}`);
      }
      if (result.interaction?.responseText !== null && result.interaction?.responseText !== undefined) {
        console.log(`RESPONSE ${result.interaction.responseText}`);
      }
      printLatency("CAPTURE_END_OF_UTTERANCE_MS", stageStartedAt, "LISTENING", "VERIFYING_SPEAKER");
      printCrossLatency(
        "WAIT_FOR_SPEECH_MS",
        stageStartedAt.get("LISTENING"),
        activityStartedAt.get("SPEECH_START")
      );
      printCrossLatency(
        "SPEECH_TO_END_OF_UTTERANCE_MS",
        activityStartedAt.get("SPEECH_START"),
        activityStartedAt.get("SPEECH_END")
      );
      printCrossLatency(
        "TRAILING_SILENCE_MS",
        activityStartedAt.get("TRAILING_SILENCE"),
        activityStartedAt.get("SPEECH_END")
      );
      printLatency("VOICEID_MS", stageStartedAt, "VERIFYING_SPEAKER", "TRANSCRIBING");
      printLatency("STT_MS", stageStartedAt, "TRANSCRIBING", "UNDERSTANDING");
      printLatency("TOOL_MS", stageStartedAt, "EXECUTING", "RESPONDING");
      printLatency("TTS_PLAYBACK_MS", stageStartedAt, "RESPONDING", "COMPLETE");
      if (result.interaction?.playback?.processStartupLatencyMs !== undefined) {
        console.log(
          `TTS_PROCESS_STARTUP_MS ${result.interaction.playback.processStartupLatencyMs.toFixed(1)}`
        );
      }
      console.log(`TOTAL_LATENCY_MS ${(performance.now() - startedAt).toFixed(1)}`);
      if (result.state !== "COMPLETE") process.exitCode = result.state === "CANCELLED" ? 130 : 2;
    } finally {
      await live?.close();
      await whisper.close();
    }
  }
} catch (error) {
  const safe = error instanceof JarvisError
    ? error
    : new JarvisError("INTERNAL_ERROR", 500, "Live voice mode failed.");
  console.error(`${safe.code}: ${safe.message}`);
  process.exitCode = safe.statusCode >= 500 ? 1 : 2;
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}

function printCrossLatency(
  label: string,
  startedAt: number | undefined,
  completedAt: number | undefined
): void {
  if (startedAt !== undefined && completedAt !== undefined && completedAt >= startedAt) {
    console.log(`${label} ${(completedAt - startedAt).toFixed(1)}`);
  }
}

function printLatency(
  label: string,
  stages: ReadonlyMap<LiveVoiceState, number>,
  from: LiveVoiceState,
  to: LiveVoiceState
): void {
  const startedAt = stages.get(from);
  const completedAt = stages.get(to);
  if (startedAt !== undefined && completedAt !== undefined && completedAt >= startedAt) {
    console.log(`${label} ${(completedAt - startedAt).toFixed(1)}`);
  }
}
