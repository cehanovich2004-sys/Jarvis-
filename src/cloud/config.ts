import { JarvisError } from "../errors.js";
import type { IntelligenceMode } from "./contracts.js";

export function loadIntelligenceMode(environment: NodeJS.ProcessEnv = process.env): IntelligenceMode {
  const mode = environment.JARVIS_INTELLIGENCE_MODE ?? "HYBRID";
  if (mode !== "LOCAL" && mode !== "HYBRID" && mode !== "MAX") throw unavailable();
  return mode;
}

export interface CloudProviderConfiguration {
  readonly endpoint: string;
  readonly model: string;
  readonly timeoutMilliseconds: number;
  readonly maxOutputTokens: number;
}

export function loadCloudProviderConfiguration(
  environment: NodeJS.ProcessEnv = process.env
): CloudProviderConfiguration {
  const endpoint = environment.JARVIS_CLOUD_LLM_URL ?? "https://api.openai.com/v1/chat/completions";
  const model = environment.JARVIS_CLOUD_MODEL ?? "gpt-4.1-mini";
  const timeoutMilliseconds = Number(environment.JARVIS_CLOUD_TIMEOUT_MS ?? "30000");
  const maxOutputTokens = Number(environment.JARVIS_CLOUD_MAX_OUTPUT_TOKENS ?? "512");
  if (
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(model) ||
    !Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0 ||
    !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0 || maxOutputTokens > 4_096
  ) throw unavailable();
  return { endpoint, model, timeoutMilliseconds, maxOutputTokens };
}

function unavailable(): JarvisError {
  return new JarvisError("CLOUD_MODEL_UNAVAILABLE", 503, "Cloud model configuration is unavailable.");
}
