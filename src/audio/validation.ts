import { JarvisError } from "../errors.js";
import {
  JARVIS_AUDIO_CHANNELS,
  JARVIS_AUDIO_SAMPLE_RATE,
  type AudioChunk,
  type AudioLimits
} from "./contracts.js";

export const DEFAULT_AUDIO_LIMITS: AudioLimits = {
  maxDurationSeconds: 30,
  maxBufferBytes: JARVIS_AUDIO_SAMPLE_RATE * 30 * Float32Array.BYTES_PER_ELEMENT
};

export function validateAudioLimits(limits: AudioLimits): void {
  if (
    !Number.isFinite(limits.maxDurationSeconds) ||
    limits.maxDurationSeconds <= 0 ||
    !Number.isSafeInteger(limits.maxBufferBytes) ||
    limits.maxBufferBytes <= 0
  ) {
    throw invalidAudio("Audio limits are invalid.");
  }
}

export function validateAudioChunk(chunk: AudioChunk): void {
  if (chunk.sampleRate !== JARVIS_AUDIO_SAMPLE_RATE) {
    throw invalidAudio("Audio sample rate is unsupported.");
  }

  if (chunk.channels !== JARVIS_AUDIO_CHANNELS) {
    throw invalidAudio("Audio channel count is unsupported.");
  }

  if (chunk.format !== "pcm-f32") {
    throw invalidAudio("Audio sample format is unsupported.");
  }

  if (!(chunk.samples instanceof Float32Array) || chunk.samples.length === 0) {
    throw invalidAudio("Audio samples are empty or corrupt.");
  }

  for (const sample of chunk.samples) {
    if (!Number.isFinite(sample) || sample < -1 || sample > 1) {
      throw invalidAudio("Audio samples contain invalid values.");
    }
  }
}

function invalidAudio(message: string): JarvisError {
  return new JarvisError("AUDIO_INVALID", 422, message);
}
