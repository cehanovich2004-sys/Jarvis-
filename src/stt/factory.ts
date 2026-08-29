import { SpeechToTextAdapter } from "./adapter.js";
import { loadSTTConfig } from "./config.js";
import { SpeechToTextService } from "./service.js";
import { WhisperCppRuntimeClient } from "./whisper-cpp-runtime.js";

export interface LocalSpeechToTextFactoryOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly backendVersion?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export function createLocalSpeechToTextService(
  options: LocalSpeechToTextFactoryOptions = {}
): SpeechToTextService {
  const config = loadSTTConfig(options.environment);
  const runtime = new WhisperCppRuntimeClient({
    endpoint: config.endpoint,
    model: config.model,
    ...(options.backendVersion === undefined ? {} : { backendVersion: options.backendVersion }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch })
  });
  const adapter = new SpeechToTextAdapter(runtime, {
    timeoutMilliseconds: config.timeoutMilliseconds
  });
  return new SpeechToTextService(adapter, config.languageMode);
}
