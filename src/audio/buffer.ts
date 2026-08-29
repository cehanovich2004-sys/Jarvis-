import { JarvisError } from "../errors.js";
import {
  FLOAT32_BYTES_PER_SAMPLE,
  JARVIS_AUDIO_CHANNELS,
  JARVIS_AUDIO_SAMPLE_RATE,
  type AudioChunk,
  type AudioData,
  type AudioLimits
} from "./contracts.js";
import { DEFAULT_AUDIO_LIMITS, validateAudioChunk, validateAudioLimits } from "./validation.js";

export class BoundedAudioBuffer {
  readonly #limits: AudioLimits;
  #chunks: Float32Array[] = [];
  #sampleCount = 0;

  constructor(limits: AudioLimits = DEFAULT_AUDIO_LIMITS) {
    validateAudioLimits(limits);
    this.#limits = limits;
  }

  get sampleCount(): number {
    return this.#sampleCount;
  }

  get durationSeconds(): number {
    return this.#sampleCount / JARVIS_AUDIO_SAMPLE_RATE / JARVIS_AUDIO_CHANNELS;
  }

  append(chunk: AudioChunk): void {
    validateAudioChunk(chunk);

    const nextSamples = this.#sampleCount + chunk.samples.length;
    const nextBytes = nextSamples * FLOAT32_BYTES_PER_SAMPLE;
    const nextDuration = nextSamples / chunk.sampleRate / chunk.channels;

    if (nextBytes > this.#limits.maxBufferBytes || nextDuration > this.#limits.maxDurationSeconds) {
      throw new JarvisError("AUDIO_BUFFER_OVERFLOW", 413, "Audio buffer limit exceeded.");
    }

    this.#chunks.push(chunk.samples.slice());
    this.#sampleCount = nextSamples;
  }

  snapshot(): AudioData {
    if (this.#sampleCount === 0) {
      throw new JarvisError("AUDIO_INVALID", 422, "Audio samples are empty or corrupt.");
    }

    const samples = new Float32Array(this.#sampleCount);
    let offset = 0;
    for (const chunk of this.#chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }

    return {
      sampleRate: JARVIS_AUDIO_SAMPLE_RATE,
      channels: JARVIS_AUDIO_CHANNELS,
      format: "pcm-f32",
      samples,
      durationSeconds: this.durationSeconds
    };
  }

  clear(): void {
    this.#chunks = [];
    this.#sampleCount = 0;
  }
}
