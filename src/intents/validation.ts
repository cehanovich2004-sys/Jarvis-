import { JarvisError } from "../errors.js";
import type { StructuredCommand } from "./contracts.js";

export function validateStructuredCommand(command: StructuredCommand): void {
  if (
    typeof command !== "object" ||
    command === null ||
    !Number.isFinite(command.confidence) ||
    command.confidence < 0 ||
    command.confidence > 1 ||
    typeof command.parameters !== "object" ||
    command.parameters === null
  ) {
    throw notAllowed();
  }
  if (command.intent === "OPEN_APPLICATION") {
    const keys = Object.keys(command.parameters);
    if (
      keys.length !== 1 ||
      keys[0] !== "application" ||
      (command.parameters.application !== "Safari" && command.parameters.application !== "Finder")
    ) {
      throw notAllowed();
    }
    return;
  }
  if (command.intent === "GET_BATTERY" && Object.keys(command.parameters).length === 0) {
    return;
  }
  throw notAllowed();
}

function notAllowed(): JarvisError {
  return new JarvisError("ACTION_NOT_ALLOWED", 403, "Action is not allowed.");
}
