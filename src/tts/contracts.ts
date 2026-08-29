export const DEFAULT_MAX_SPEECH_CHARACTERS = 1_000;

export type SpeechLanguage = "RU" | "EN";

export interface SpeechRequest {
  readonly text: string;
  readonly language?: SpeechLanguage;
}

export interface TTSBackendMetadata {
  readonly backend: string;
  readonly voice: string;
  readonly rateWordsPerMinute: number;
}

export interface SpeechPlaybackResult {
  readonly status: "COMPLETED";
  readonly characterCount: number;
  readonly playbackLatencyMs: number;
  readonly backendMetadata: TTSBackendMetadata;
}

export interface SpeechPlaybackOptions {
  readonly signal?: AbortSignal;
}

export interface TextToSpeechServiceContract {
  speak(request: SpeechRequest, options?: SpeechPlaybackOptions): Promise<SpeechPlaybackResult>;
}
