import type { VoiceInteractionTerminalState } from "../interaction/contracts.js";
import type { InteractionResponseGenerator } from "../interaction/responses.js";
import type { ToolExecutionResult } from "../tools/contracts.js";
import type { HumorLevel, PersonalityEngine, ResponseContent } from "./contracts.js";

export class PersonalityInteractionResponseGenerator implements InteractionResponseGenerator {
  constructor(
    private readonly engine: PersonalityEngine,
    private readonly humorLevel: HumorLevel = 2,
    private readonly variationSeed?: number
  ) {}

  forExecutionFailure(): string {
    return this.#render({ kind: "ERROR", reason: "ACTION_FAILED" });
  }

  forAlternateState(state: VoiceInteractionTerminalState): string {
    if (state === "UNAUTHORIZED") {
      return this.#render({ kind: "SECURITY_DENIAL", reason: "IDENTITY_UNAUTHORIZED" });
    }
    if (state === "UNCERTAIN_IDENTITY") {
      return this.#render({ kind: "SECURITY_DENIAL", reason: "IDENTITY_UNCERTAIN" });
    }
    if (state === "NO_SPEECH" || state === "UNCERTAIN_SPEECH") {
      return this.#render({ kind: "UNCERTAIN", reason: "SPEECH" });
    }
    if (state === "NO_MATCH") {
      return this.#render({ kind: "UNCERTAIN", reason: "COMMAND" });
    }
    throw new Error("No personality response exists for the interaction state.");
  }

  forExecution(result: ToolExecutionResult): string {
    if (result.status === "FAILED") return this.forExecutionFailure();
    if (result.intent === "OPEN_APPLICATION") {
      return this.#render({
        kind: "APPLICATION_OPENED",
        facts: { application: result.data.application }
      });
    }
    return this.#render({
      kind: "BATTERY_STATUS",
      facts: {
        percentage: result.data.percentage,
        powerSource: result.data.powerSource
      }
    });
  }

  #render(content: ResponseContent): string {
    return this.engine.render(content, {
      humorLevel: this.humorLevel,
      ...(this.variationSeed === undefined ? {} : { variationSeed: this.variationSeed })
    }).text;
  }
}
