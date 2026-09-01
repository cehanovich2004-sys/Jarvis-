import type { TranscriptResult } from "../stt/contracts.js";
import type {
  AllowedApplication,
  IntentRouter,
  IntentRoutingResult,
  StructuredCommand
} from "./contracts.js";

const APPLICATION_ALIASES: Readonly<Record<string, AllowedApplication>> = {
  safari: "Safari",
  "сафари": "Safari",
  finder: "Finder",
  "файндер": "Finder"
};

const OPEN_PATTERNS = [
  /^(?:джарвис[,.]?\s*)?(?:открой|запусти)\s+(.+)$/u,
  /^(?:jarvis[,.]?\s*)?(?:open|launch)\s+(.+)$/u
];

const BATTERY_PATTERNS = [
  /^(?:джарвис[,.]?\s*)?(?:какой\s+)?(?:заряд|заряд\s+батареи|заряд\s+аккумулятора)(?:\s+сейчас)?[?.!]*$/u,
  /^(?:jarvis[,.]?\s*)?(?:what(?:'s|\s+is)\s+the\s+)?battery(?:\s+level)?[?.!]*$/u
];

export class DeterministicIntentRouter implements IntentRouter {
  route(transcript: TranscriptResult): IntentRoutingResult {
    if (transcript.status === "UNCERTAIN") {
      return { status: "UNCERTAIN", command: null };
    }
    if (transcript.status !== "SUCCESS") {
      return { status: "NO_MATCH", command: null };
    }
    if (typeof transcript.text !== "string") {
      return { status: "NO_MATCH", command: null };
    }
    const normalized = stripSafeInvocationPrefix(
      transcript.text.normalize("NFKC").trim().toLocaleLowerCase("ru-RU")
    );
    const battery = BATTERY_PATTERNS.some((pattern) => pattern.test(normalized));
    if (battery) {
      return { status: "MATCHED", command: commandForBattery() };
    }
    for (const pattern of OPEN_PATTERNS) {
      const match = pattern.exec(normalized);
      const rawApplication = match?.[1]?.replace(/[?.!]+$/u, "").trim();
      if (rawApplication !== undefined) {
        const application = APPLICATION_ALIASES[rawApplication];
        if (application !== undefined) {
          return { status: "MATCHED", command: commandForApplication(application) };
        }
      }
    }
    return { status: "NO_MATCH", command: null };
  }
}

function stripSafeInvocationPrefix(value: string): string {
  return value.replace(/^слушай[,.]?[ ]+/u, "");
}

function commandForApplication(application: AllowedApplication): StructuredCommand {
  return { intent: "OPEN_APPLICATION", parameters: { application }, confidence: 1 };
}

function commandForBattery(): StructuredCommand {
  return { intent: "GET_BATTERY", parameters: {}, confidence: 1 };
}
