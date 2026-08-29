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
