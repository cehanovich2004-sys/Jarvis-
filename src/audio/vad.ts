import type { AudioChunk, VoiceActivity } from "./contracts.js";

export interface VoiceActivityDetector {
  process(chunk: AudioChunk): Promise<VoiceActivity>;
  reset(): void;
}
