export const DEFAULT_MAX_TRANSCRIPT_CHARACTERS = 4_096;

export type STTLanguageMode = "AUTO" | "RU" | "EN";
export type TranscriptStatus = "SUCCESS" | "EMPTY" | "UNCERTAIN";

export interface STTBackendMetadata {
  readonly backend: string;
  readonly backendVersion?: string;
  readonly model: string;
}

export interface TranscriptResult {
  readonly status: TranscriptStatus;
  readonly text: string;
  readonly language?: string;
  readonly confidence?: number;
  readonly languageConfidence?: number;
  readonly durationSeconds: number;
  readonly transcriptionLatencyMs: number;
  readonly backendMetadata: STTBackendMetadata;
}

export interface TranscriptionOptions {
  readonly languageMode?: STTLanguageMode;
  readonly signal?: AbortSignal;
}

export interface SpeechToTextServiceContract {
  transcribe(
    audio: import("../audio/contracts.js").AudioData,
    options?: TranscriptionOptions
  ): Promise<TranscriptResult>;
}
