import { JarvisError } from "../errors.js";

export interface LocalLLMConfig {
  readonly backend: "ollama";
  readonly endpoint: string;
  readonly model: string;
  readonly timeoutMilliseconds: number;
  readonly maxOutputTokens: number;
}

export function loadLocalLLMConfig(environment: NodeJS.ProcessEnv = process.env): LocalLLMConfig {
  const backend = environment.JARVIS_LOCAL_LLM_BACKEND ?? "ollama";
  const endpoint = environment.JARVIS_LOCAL_LLM_URL ?? "http://127.0.0.1:11434/api/generate";
  const model = environment.JARVIS_LOCAL_MODEL ?? "qwen2.5:7b";
  const timeoutMilliseconds = Number(environment.JARVIS_LOCAL_LLM_TIMEOUT_MS ?? "30000");
  const maxOutputTokens = Number(environment.JARVIS_LOCAL_LLM_MAX_OUTPUT_TOKENS ?? "512");
  if (
    backend !== "ollama" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(model) ||
    !Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0 ||
    !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0
  ) throw new JarvisError("LLM_MODEL_UNAVAILABLE", 503, "Local LLM configuration is invalid.");
  return { backend, endpoint, model, timeoutMilliseconds, maxOutputTokens };
}
