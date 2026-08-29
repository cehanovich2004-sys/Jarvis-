import { JarvisError } from "../errors.js";
import type { IntentKind, PermissionDecision, StructuredCommand } from "./contracts.js";
import { validateStructuredCommand } from "./validation.js";

const RISK_BY_INTENT: Readonly<Record<IntentKind, "LOW">> = {
  OPEN_APPLICATION: "LOW",
  GET_BATTERY: "LOW"
};

export class PermissionEngine {
  assess(command: StructuredCommand): PermissionDecision {
    validateStructuredCommand(command);
    const risk = RISK_BY_INTENT[command.intent];
    if (risk === undefined) {
      throw new JarvisError("ACTION_NOT_ALLOWED", 403, "Action is not allowed.");
    }
    return { risk, allowed: true, confirmationRequired: false };
  }
}
