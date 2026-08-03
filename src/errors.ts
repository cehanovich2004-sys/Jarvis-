import type { ErrorCode, ErrorResponse } from "./contracts.js";

export class JarvisError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(code: ErrorCode, statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = "JarvisError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toResponse(): ErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details })
      }
    };
  }
}

export function toJarvisError(error: unknown): JarvisError {
  if (error instanceof JarvisError) {
    return error;
  }

  return new JarvisError("INTERNAL_ERROR", 500, "Unexpected Jarvis Core error.");
}
