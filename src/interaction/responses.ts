import type { ToolExecutionResult } from "../tools/contracts.js";
import type { VoiceInteractionTerminalState } from "./contracts.js";

const ALTERNATE_RESPONSES: Readonly<
  Partial<Record<VoiceInteractionTerminalState, string>>
> = {
  UNAUTHORIZED: "Я не могу подтвердить голос владельца.",
  UNCERTAIN_IDENTITY: "Я не уверен, что это голос владельца.",
  NO_SPEECH: "Речь не распознана.",
  UNCERTAIN_SPEECH: "Не удалось уверенно распознать речь.",
  NO_MATCH: "Команда не распознана."
};

export class DeterministicResponseGenerator {
  forExecutionFailure(): string {
    return "Не удалось выполнить команду.";
  }

  forAlternateState(state: VoiceInteractionTerminalState): string {
    const response = ALTERNATE_RESPONSES[state];
    if (response === undefined) {
      throw new Error("No deterministic response exists for the interaction state.");
    }
    return response;
  }

  forExecution(result: ToolExecutionResult): string {
    if (result.status === "FAILED") {
      return this.forExecutionFailure();
    }
    if (result.intent === "OPEN_APPLICATION") {
      return `${result.data.application} открыт.`;
    }
    const power = result.data.powerSource === "AC" ? "Питание от сети." : "Питание от батареи.";
    return `Заряд батареи ${result.data.percentage} процентов. ${power}`;
  }
}
