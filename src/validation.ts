import { SUPPORTED_COMMAND_TEXTS, type CreateCommandRequest, type SupportedCommandText } from "./contracts.js";
import { JarvisError } from "./errors.js";

const commandIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

export function normalizeCommandText(text: string): string {
  return text.trim().toLowerCase();
}

export function assertCommandId(id: string): void {
  if (!commandIdPattern.test(id)) {
    throw new JarvisError("INVALID_PAYLOAD", 400, "Command id must be 1-64 ASCII letters, numbers, underscores, or hyphens.", {
      field: "id"
    });
  }
}

export function parseCreateCommandRequest(value: unknown): CreateCommandRequest {
  if (!isRecord(value)) {
    throw new JarvisError("INVALID_PAYLOAD", 400, "Payload must be a JSON object.");
  }

  const text = value.text;
  if (typeof text !== "string" || text.trim() === "") {
    throw new JarvisError("INVALID_PAYLOAD", 400, "Payload field `text` must be a non-empty string.", {
      field: "text"
    });
  }

  const id = value.id;
  if (id !== undefined) {
    if (typeof id !== "string") {
      throw new JarvisError("INVALID_PAYLOAD", 400, "Payload field `id` must be a string when present.", {
        field: "id"
      });
    }

    assertCommandId(id);
  }

  return id === undefined ? { text } : { id, text };
}

export function parseSupportedCommandText(text: string): SupportedCommandText {
  const normalized = normalizeCommandText(text);

  if (SUPPORTED_COMMAND_TEXTS.includes(normalized as SupportedCommandText)) {
    return normalized as SupportedCommandText;
  }

  throw new JarvisError("COMMAND_NOT_SUPPORTED", 422, "Only `статус` and `помощь` are supported in this increment.", {
    supported: SUPPORTED_COMMAND_TEXTS
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

