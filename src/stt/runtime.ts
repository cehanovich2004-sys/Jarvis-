import type { STTBackendMetadata, STTLanguageMode, TranscriptStatus } from "./contracts.js";

export type STTRuntimeErrorCode =
  | "INVALID_AUDIO"
  | "MODEL_UNAVAILABLE"
  | "INFERENCE_FAILED"
  | "MEMORY_LIMIT_EXCEEDED";

export interface STTAudioInput {
  readonly waveform: Float32Array;
  readonly sampleRateHz: 16_000;
  readonly channels: 1;
  readonly format: "pcm-f32";
  readonly languageMode: STTLanguageMode;
}

export type STTRuntimeResult =
  | {
      readonly status: TranscriptStatus;
      readonly text: string;
      readonly language?: string;
      readonly confidence?: number;
      readonly languageConfidence?: number;
    }
  | {
      readonly status: "INVALID";
      readonly errorCode: STTRuntimeErrorCode;
    };

export interface STTRuntimeClient {
  readonly metadata: STTBackendMetadata;
  transcribe(input: STTAudioInput, signal?: AbortSignal): Promise<STTRuntimeResult>;
}
