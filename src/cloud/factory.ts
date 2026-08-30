import { JarvisError } from "../errors.js";
import { loadCloudProviderConfiguration } from "./config.js";
import { OpenAICompatibleCloudRuntime } from "./openai-compatible-runtime.js";
import { ValidatedCloudLLMProvider } from "./provider.js";

export function createCloudLLMProvider(options: {
  readonly environment?: NodeJS.ProcessEnv;
  readonly fetch?: typeof globalThis.fetch;
} = {}): ValidatedCloudLLMProvider {
  const environment = options.environment ?? process.env;
  const apiKey = environment.JARVIS_CLOUD_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length < 8) {
    throw new JarvisError("CLOUD_MODEL_UNAVAILABLE", 503, "Cloud model configuration is unavailable.");
  }
  const config = loadCloudProviderConfiguration(environment);
  const runtime = new OpenAICompatibleCloudRuntime({
    endpoint: config.endpoint,
    apiKey,
    model: config.model,
    maxOutputTokens: config.maxOutputTokens,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch })
  });
  return new ValidatedCloudLLMProvider(runtime, {
    timeoutMilliseconds: config.timeoutMilliseconds
  });
}
