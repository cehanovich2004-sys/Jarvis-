import type {
  SpeechPlaybackOptions,
  SpeechPlaybackResult,
  SpeechRequest,
  TextToSpeechServiceContract
} from "./contracts.js";
import { TextToSpeechAdapter } from "./adapter.js";

export class TextToSpeechService implements TextToSpeechServiceContract {
  readonly #adapter: TextToSpeechAdapter;

  constructor(adapter: TextToSpeechAdapter) {
    this.#adapter = adapter;
  }

  speak(request: SpeechRequest, options: SpeechPlaybackOptions = {}): Promise<SpeechPlaybackResult> {
    return this.#adapter.speak(request, options.signal);
  }
}
