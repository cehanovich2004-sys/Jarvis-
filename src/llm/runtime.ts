import type { LocalLLMMetadata } from "./contracts.js";

export type LocalLLMRuntimeResult =
  | { readonly status: "VALID"; readonly output: string }
  | { readonly status: "INVALID"; readonly errorCode: "MODEL_UNAVAILABLE" | "INFERENCE_FAILED" };

export interface LocalLLMRuntimeClient {
  readonly metadata: LocalLLMMetadata;
  generate(prompt: string, signal?: AbortSignal): Promise<LocalLLMRuntimeResult>;
}
