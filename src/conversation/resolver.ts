import type { StructuredCommand } from "../intents/contracts.js";
import type { ConversationSessionSnapshot } from "./contracts.js";

export type ConversationResolution =
  | { readonly kind: "INTENT_PROPOSAL"; readonly command: StructuredCommand }
  | { readonly kind: "ANSWER"; readonly text: string }
  | null;

export class DeterministicConversationResolver {
  resolve(currentText: string, session: ConversationSessionSnapshot): ConversationResolution {
    const normalized = currentText.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
    const latest = [...session.turns].reverse();
    const application = /^(?:теперь|then)\s+(safari|сафари|finder|файндер)[?.!]*$/u.exec(normalized)?.[1];
    const hasApplicationContext = latest.some(
      (turn) => turn.outcome.kind === "INTENT" && turn.outcome.command.intent === "OPEN_APPLICATION"
    );
    if (application !== undefined && hasApplicationContext) {
      const mapped = application === "safari" || application === "сафари" ? "Safari" : "Finder";
      return {
        kind: "INTENT_PROPOSAL",
        command: { intent: "OPEN_APPLICATION", parameters: { application: mapped }, confidence: 1 }
      };
    }
    if (/^(?:он\s+)?подключ[её]н\s+к\s+сети[?.!]*$/u.test(normalized)) {
      const battery = latest.find(
        (turn) => turn.tool?.intent === "GET_BATTERY" && turn.tool.status === "SUCCESS"
      )?.tool;
      if (battery?.intent === "GET_BATTERY" && battery.status === "SUCCESS") {
        return {
          kind: "ANSWER",
          text: battery.powerSource === "AC" ? "Да, питание от сети." : "Нет, питание от батареи."
        };
      }
    }
    return null;
  }
}
