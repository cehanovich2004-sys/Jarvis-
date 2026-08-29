import type { AudioChunk } from "./contracts.js";

export interface MicrophoneInput {
  chunks(signal?: AbortSignal): AsyncIterable<AudioChunk>;
  close(): Promise<void>;
}

export class RecordedAudioInput implements MicrophoneInput {
  readonly #chunks: readonly AudioChunk[];
  #closed = false;

  constructor(chunks: readonly AudioChunk[]) {
    this.#chunks = chunks;
  }

  async *chunks(signal?: AbortSignal): AsyncIterable<AudioChunk> {
    for (const chunk of this.#chunks) {
      if (this.#closed || signal?.aborted) {
        return;
      }
      yield chunk;
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
  }
}
