export const JARVIS_AUDIO_SAMPLE_RATE = 16_000;
export const JARVIS_AUDIO_CHANNELS = 1;
export const FLOAT32_BYTES_PER_SAMPLE = 4;

export type AudioSampleFormat = "pcm-f32";

export interface AudioChunk {
  readonly sampleRate: number;
  readonly channels: number;
  readonly format: AudioSampleFormat;
  readonly samples: Float32Array;
}

export interface AudioData extends AudioChunk {
  readonly durationSeconds: number;
}

export interface AudioLimits {
  readonly maxDurationSeconds: number;
  readonly maxBufferBytes: number;
}

export type VoiceActivity = "SILENCE" | "SPEECH_START" | "SPEECH" | "SPEECH_END";

export type AudioSessionState =
  | "START"
  | "LISTENING"
  | "SPEECH"
  | "COMPLETE"
  | "TIMEOUT"
  | "CANCELLED"
  | "ERROR";

export interface CompletedAudioSession {
  readonly state: "COMPLETE";
  readonly audio: AudioData;
}

export interface IncompleteAudioSession {
  readonly state: "TIMEOUT" | "CANCELLED";
  readonly audio: null;
}

export type AudioSessionResult = CompletedAudioSession | IncompleteAudioSession;
