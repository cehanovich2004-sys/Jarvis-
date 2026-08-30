export const SUPPORTED_COMMAND_TEXTS = ["статус", "помощь"] as const;

export type SupportedCommandText = (typeof SUPPORTED_COMMAND_TEXTS)[number];
export type CommandKind = "status" | "help";
export type CommandState = "completed";

export interface HealthResponse {
  service: "jarvis-core";
  status: "ok";
  version: string;
  bindHost: string;
  storage: "memory";
  uptimeSeconds: number;
}

export interface CreateCommandRequest {
  id?: string;
  text: string;
}

export interface CommandRecord {
  id: string;
  text: string;
  normalizedText: SupportedCommandText;
  kind: CommandKind;
  state: CommandState;
  response: string;
  createdAt: string;
  completedAt: string;
}

export interface CommandResponse {
  command: CommandRecord;
}

export type ErrorCode =
  | "INVALID_JSON"
  | "INVALID_PAYLOAD"
  | "COMMAND_NOT_SUPPORTED"
  | "COMMAND_ID_CONFLICT"
  | "COMMAND_NOT_FOUND"
  | "AUDIO_INVALID"
  | "AUDIO_BUFFER_OVERFLOW"
  | "AUDIO_INPUT_FAILURE"
  | "SPEAKER_INVALID_AUDIO"
  | "SPEAKER_EMBEDDING_FAILURE"
  | "SPEAKER_MODEL_UNAVAILABLE"
  | "SPEAKER_INVALID_EMBEDDING"
  | "SPEAKER_PROFILE_NOT_FOUND"
  | "SPEAKER_PROFILE_INCOMPATIBLE"
  | "SPEAKER_VERIFICATION_FAILURE"
  | "STT_INVALID_AUDIO"
  | "STT_MODEL_UNAVAILABLE"
  | "STT_RUNTIME_FAILURE"
  | "STT_TIMEOUT"
  | "STT_CANCELLED"
  | "STT_INVALID_RESPONSE"
  | "ACTION_NOT_ALLOWED"
  | "TOOL_NOT_FOUND"
  | "TOOL_EXECUTION_FAILED"
  | "TOOL_VERIFICATION_FAILED"
  | "TTS_INVALID_TEXT"
  | "TTS_VOICE_UNAVAILABLE"
  | "TTS_RUNTIME_FAILURE"
  | "TTS_TIMEOUT"
  | "TTS_CANCELLED"
  | "TTS_INVALID_RESPONSE"
  | "LLM_INVALID_INPUT"
  | "LLM_MODEL_UNAVAILABLE"
  | "LLM_RUNTIME_FAILURE"
  | "LLM_TIMEOUT"
  | "LLM_CANCELLED"
  | "LLM_INVALID_RESPONSE"
  | "CONVERSATION_INVALID"
  | "CONVERSATION_NOT_FOUND"
  | "CONVERSATION_EXPIRED"
  | "CONVERSATION_CANCELLED"
  | "PERSONALITY_INVALID_CONTENT"
  | "PERSONALITY_INVALID_CONFIG"
  | "INTERACTION_INVALID_ID"
  | "LIVE_VOICE_BUSY"
  | "MEMORY_INVALID"
  | "MEMORY_APPROVAL_REQUIRED"
  | "MEMORY_DUPLICATE"
  | "MEMORY_NOT_FOUND"
  | "MEMORY_CONFLICT"
  | "MEMORY_CAPACITY_EXCEEDED"
  | "MEMORY_STORE_CORRUPT"
  | "MEMORY_STORE_UNSAFE"
  | "MEMORY_STORAGE_FAILURE"
  | "MEMORY_CANCELLED"
  | "CLOUD_DISABLED"
  | "CLOUD_PRIVACY_REJECTED"
  | "CLOUD_MODEL_UNAVAILABLE"
  | "CLOUD_RUNTIME_FAILURE"
  | "CLOUD_TIMEOUT"
  | "CLOUD_CANCELLED"
  | "CLOUD_INVALID_RESPONSE"
  | "INTERNAL_ERROR"
  | "METHOD_NOT_ALLOWED"
  | "ROUTE_NOT_FOUND";

export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}
