import { JarvisError } from "../errors.js";
import type { StructuredCommand } from "../intents/contracts.js";
import { PermissionEngine } from "../intents/permissions.js";
import type { ToolExecutionResult } from "./contracts.js";
import { ToolRegistry } from "./registry.js";

export class SafeActionExecutor {
  readonly #permissions: PermissionEngine;
  readonly #registry: ToolRegistry;

  constructor(permissions: PermissionEngine, registry: ToolRegistry) {
    this.#permissions = permissions;
    this.#registry = registry;
  }

  execute(command: StructuredCommand, signal?: AbortSignal): Promise<ToolExecutionResult> {
    const decision = this.#permissions.assess(command);
    if (!decision.allowed || decision.confirmationRequired) {
      throw new JarvisError("ACTION_NOT_ALLOWED", 403, "Action is not allowed.");
    }
    return this.#registry.execute(command, signal);
  }
}
