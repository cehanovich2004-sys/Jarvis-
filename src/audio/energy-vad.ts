import { JarvisError } from "../errors.js";
import type { AudioChunk, VoiceActivity } from "./contracts.js";
import type { VoiceActivityDetector } from "./vad.js";
import { validateAudioChunk } from "./validation.js";

export interface EnergyVoiceActivityDetectorOptions {
  readonly speechThreshold?: number;
  readonly endSilenceMilliseconds?: number;
}

export class EnergyVoiceActivityDetector implements VoiceActivityDetector {
  readonly #speechThreshold: number;
  readonly #endSilenceMilliseconds: number;
  #speechStarted = false;
  #silenceMilliseconds = 0;

  constructor(options: EnergyVoiceActivityDetectorOptions = {}) {
    this.#speechThreshold = options.speechThreshold ?? 0.015;
    this.#endSilenceMilliseconds = options.endSilenceMilliseconds ?? 500;
    if (
      !Number.isFinite(this.#speechThreshold) ||
      this.#speechThreshold <= 0 ||
      this.#speechThreshold > 1 ||
      !Number.isSafeInteger(this.#endSilenceMilliseconds) ||
      this.#endSilenceMilliseconds <= 0 ||
      this.#endSilenceMilliseconds > 10_000
    ) {
      throw new JarvisError("AUDIO_INVALID", 422, "Voice activity configuration is invalid.");
    }
  }

  async process(chunk: AudioChunk): Promise<VoiceActivity> {
    validateAudioChunk(chunk);
    const speech = rootMeanSquare(chunk.samples) >= this.#speechThreshold;
    const durationMilliseconds = chunk.samples.length / chunk.sampleRate * 1_000;

    if (!this.#speechStarted) {
      if (!speech) return "SILENCE";
      this.#speechStarted = true;
      this.#silenceMilliseconds = 0;
      return "SPEECH_START";
    }

    if (speech) {
      this.#silenceMilliseconds = 0;
      return "SPEECH";
    }

    this.#silenceMilliseconds += durationMilliseconds;
    if (this.#silenceMilliseconds >= this.#endSilenceMilliseconds) {
      return "SPEECH_END";
    }
    return "TRAILING_SILENCE";
  }

  reset(): void {
    this.#speechStarted = false;
    this.#silenceMilliseconds = 0;
  }
}

function rootMeanSquare(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}
