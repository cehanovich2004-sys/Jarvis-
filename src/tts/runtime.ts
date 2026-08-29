import type { TTSBackendMetadata } from "./contracts.js";

export type TTSRuntimeErrorCode = "VOICE_UNAVAILABLE" | "PLAYBACK_FAILED";

export interface TTSRuntimeInput {
  readonly text: string;
}

export type TTSRuntimeResult =
  | { readonly status: "COMPLETED" }
  | { readonly status: "INVALID"; readonly errorCode: TTSRuntimeErrorCode };

export interface TTSRuntimeClient {
  readonly metadata: TTSBackendMetadata;
  speak(input: TTSRuntimeInput, signal?: AbortSignal): Promise<TTSRuntimeResult>;
}
