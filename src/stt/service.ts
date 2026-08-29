import type { AudioData } from "../audio/contracts.js";
import type {
  SpeechToTextServiceContract,
  STTLanguageMode,
  TranscriptResult,
  TranscriptionOptions
} from "./contracts.js";
import { SpeechToTextAdapter } from "./adapter.js";

export class SpeechToTextService implements SpeechToTextServiceContract {
  readonly #adapter: SpeechToTextAdapter;
  readonly #defaultLanguageMode: STTLanguageMode;

  constructor(adapter: SpeechToTextAdapter, defaultLanguageMode: STTLanguageMode = "AUTO") {
    this.#adapter = adapter;
    this.#defaultLanguageMode = defaultLanguageMode;
  }

  transcribe(audio: AudioData, options: TranscriptionOptions = {}): Promise<TranscriptResult> {
    return this.#adapter.transcribe(
      audio,
      options.languageMode ?? this.#defaultLanguageMode,
      options.signal
    );
  }
}
