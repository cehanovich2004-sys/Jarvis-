import { ValidatedLocalLLMProvider } from "./adapter.js";
import { loadLocalLLMConfig } from "./config.js";
import { OllamaRuntimeClient } from "./ollama-runtime.js";

export function createLocalLLMProvider(options: {
  readonly environment?: NodeJS.ProcessEnv;
  readonly fetch?: typeof globalThis.fetch;
} = {}): ValidatedLocalLLMProvider {
  const config = loadLocalLLMConfig(options.environment);
  const runtime = new OllamaRuntimeClient({
    endpoint: config.endpoint,
    model: config.model,
    maxOutputTokens: config.maxOutputTokens,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch })
  });
  return new ValidatedLocalLLMProvider(runtime, { timeoutMilliseconds: config.timeoutMilliseconds });
}
