import { TextToSpeechAdapter } from "./adapter.js";
import { loadTTSConfig } from "./config.js";
import { MacOSSystemSpeechRuntime, type MacOSSpeechProcessRunner } from "./macos-runtime.js";
import { TextToSpeechService } from "./service.js";

export interface LocalTextToSpeechFactoryOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly runner?: MacOSSpeechProcessRunner;
}

export function createLocalTextToSpeechService(
  options: LocalTextToSpeechFactoryOptions = {}
): TextToSpeechService {
  const config = loadTTSConfig(options.environment);
  const runtime = new MacOSSystemSpeechRuntime(
    config.voice,
    config.rateWordsPerMinute,
    options.runner
  );
  return new TextToSpeechService(
    new TextToSpeechAdapter(runtime, {
      timeoutMilliseconds: config.timeoutMilliseconds,
      maxSpeechCharacters: config.maxSpeechCharacters
    })
  );
}
