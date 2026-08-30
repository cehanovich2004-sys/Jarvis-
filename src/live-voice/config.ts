import { JarvisError } from "../errors.js";

export interface LiveVoiceConfiguration {
  readonly ownerProfileId: string;
  readonly microphoneExecutable: string;
  readonly microphoneDeviceIndex: number;
  readonly captureTimeoutMilliseconds: number;
  readonly maximumDurationSeconds: number;
  readonly speechThreshold: number;
  readonly endSilenceMilliseconds: number;
}

export function loadLiveVoiceConfiguration(
  environment: NodeJS.ProcessEnv = process.env
): LiveVoiceConfiguration {
  const ownerProfileId = environment.JARVIS_OWNER_PROFILE_ID ?? "owner-primary";
  const microphoneExecutable = environment.JARVIS_MICROPHONE_FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
  const microphoneDeviceIndex = Number(environment.JARVIS_MICROPHONE_DEVICE_INDEX ?? "0");
  const captureTimeoutMilliseconds = Number(environment.JARVIS_VOICE_CAPTURE_TIMEOUT_MS ?? "15000");
  const maximumDurationSeconds = Number(environment.JARVIS_VOICE_MAX_DURATION_SECONDS ?? "30");
  const speechThreshold = Number(environment.JARVIS_VAD_SPEECH_THRESHOLD ?? "0.015");
  const endSilenceMilliseconds = Number(environment.JARVIS_VAD_END_SILENCE_MS ?? "700");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/u.test(ownerProfileId) ||
    !new Set(["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]).has(microphoneExecutable) ||
    !Number.isSafeInteger(microphoneDeviceIndex) || microphoneDeviceIndex < 0 || microphoneDeviceIndex > 32 ||
    !Number.isSafeInteger(captureTimeoutMilliseconds) || captureTimeoutMilliseconds <= 0 ||
    !Number.isFinite(maximumDurationSeconds) || maximumDurationSeconds <= 0 || maximumDurationSeconds > 60 ||
    !Number.isFinite(speechThreshold) || speechThreshold <= 0 || speechThreshold > 1 ||
    !Number.isSafeInteger(endSilenceMilliseconds) || endSilenceMilliseconds <= 0 || endSilenceMilliseconds > 10_000
  ) throw unavailable();
  return {
    ownerProfileId,
    microphoneExecutable,
    microphoneDeviceIndex,
    captureTimeoutMilliseconds,
    maximumDurationSeconds,
    speechThreshold,
    endSilenceMilliseconds
  };
}

function unavailable(): JarvisError {
  return new JarvisError("AUDIO_INPUT_FAILURE", 503, "Live voice configuration is unavailable.");
}
