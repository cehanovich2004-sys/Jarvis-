import { JarvisError } from "../errors.js";
import type { STTLanguageMode } from "./contracts.js";

export interface STTConfig {
  readonly backend: "whisper.cpp";
  readonly model: string;
  readonly languageMode: STTLanguageMode;
  readonly timeoutMilliseconds: number;
  readonly endpoint: string;
}

export function loadSTTConfig(environment: NodeJS.ProcessEnv = process.env): STTConfig {
  const backend = environment.JARVIS_STT_BACKEND ?? "whisper.cpp";
  const model = environment.JARVIS_STT_MODEL ?? "base";
  const language = (environment.JARVIS_STT_LANGUAGE ?? "AUTO").toUpperCase();
  const timeout = Number(environment.JARVIS_STT_TIMEOUT_MS ?? "30000");
  const endpoint = environment.JARVIS_STT_ENDPOINT ?? "http://127.0.0.1:8080/inference";
  if (
    backend !== "whisper.cpp" ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(model) ||
    (language !== "AUTO" && language !== "RU" && language !== "EN") ||
    !Number.isSafeInteger(timeout) ||
    timeout <= 0
  ) {
    throw new JarvisError("STT_MODEL_UNAVAILABLE", 503, "Local STT configuration is invalid.");
  }
  return {
    backend,
    model,
    languageMode: language,
    timeoutMilliseconds: timeout,
    endpoint
  };
}
