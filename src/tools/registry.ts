import { JarvisError } from "../errors.js";
import type { IntentKind, StructuredCommand } from "../intents/contracts.js";
import { validateStructuredCommand } from "../intents/validation.js";
import type { RegisteredTool, ToolExecutionResult } from "./contracts.js";

export class ToolRegistry {
  readonly #tools = new Map<IntentKind, RegisteredTool>();

  register(tool: RegisteredTool): void {
    if (tool.intent !== "OPEN_APPLICATION" && tool.intent !== "GET_BATTERY") {
      throw new JarvisError("ACTION_NOT_ALLOWED", 403, "Tool is not allowed.");
    }
    if (this.#tools.has(tool.intent)) {
      throw new JarvisError("ACTION_NOT_ALLOWED", 409, "Tool is already registered.");
    }
    this.#tools.set(tool.intent, tool);
  }

  execute(command: StructuredCommand, signal?: AbortSignal): Promise<ToolExecutionResult> {
    validateStructuredCommand(command);
    const tool = this.#tools.get(command.intent);
    if (tool === undefined) {
      throw new JarvisError("TOOL_NOT_FOUND", 404, "No tool is registered for this action.");
    }
    return tool.execute(command, signal);
  }
}
