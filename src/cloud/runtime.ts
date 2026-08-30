export interface CloudRuntimeMetadata {
  readonly provider: string;
  readonly model: string;
}

export interface CloudRuntimeUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type CloudRuntimeResult =
  | {
      readonly status: "VALID";
      readonly output: string;
      readonly usage?: CloudRuntimeUsage;
    }
  | {
      readonly status: "INVALID";
      readonly errorCode: "MODEL_UNAVAILABLE" | "RUNTIME_FAILURE";
    };

export interface CloudLLMRuntimeClient {
  readonly metadata: CloudRuntimeMetadata;
  generate(prompt: string, signal?: AbortSignal): Promise<CloudRuntimeResult>;
}
