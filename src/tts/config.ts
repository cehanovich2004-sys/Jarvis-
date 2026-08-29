import { JarvisError } from "../errors.js";
import { DEFAULT_MAX_SPEECH_CHARACTERS } from "./contracts.js";

export interface TTSConfig {
  readonly backend: "macos-say";
  readonly voice: string;
  readonly rateWordsPerMinute: number;
  readonly timeoutMilliseconds: number;
  readonly maxSpeechCharacters: number;
}

export function loadTTSConfig(environment: NodeJS.ProcessEnv = process.env): TTSConfig {
  const backend = environment.JARVIS_TTS_BACKEND ?? "macos-say";
  const voice = environment.JARVIS_TTS_VOICE ?? "Milena";
  const rate = Number(environment.JARVIS_TTS_RATE_WPM ?? "180");
  const timeout = Number(environment.JARVIS_TTS_TIMEOUT_MS ?? "30000");
  const maxCharacters = Number(environment.JARVIS_TTS_MAX_CHARACTERS ?? "1000");
  if (
    backend !== "macos-say" ||
    !/^[\p{L}\p{N} ._-]{1,64}$/u.test(voice) ||
    !Number.isSafeInteger(rate) ||
    rate < 80 ||
    rate > 500 ||
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    !Number.isSafeInteger(maxCharacters) ||
    maxCharacters <= 0 ||
    maxCharacters > DEFAULT_MAX_SPEECH_CHARACTERS
  ) {
    throw new JarvisError("TTS_VOICE_UNAVAILABLE", 503, "Local TTS configuration is invalid.");
  }
  return {
    backend,
    voice,
    rateWordsPerMinute: rate,
    timeoutMilliseconds: timeout,
    maxSpeechCharacters: maxCharacters
  };
}
