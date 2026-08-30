import type { SpeechRequest } from "../tts/contracts.js";

export type HumorLevel = 0 | 1 | 2 | 3;
export type ResponseLanguage = "RU" | "EN";
export type ResponseCategory =
  | "SUCCESS"
  | "INFORMATIONAL"
  | "CLARIFICATION"
  | "ERROR"
  | "SECURITY_DENIAL"
  | "UNCERTAIN"
  | "CONVERSATIONAL";
export type PersonalityTone = "NEUTRAL" | "LIGHT_IRONY" | "NOTICEABLE_HUMOR";

export type ResponseContent =
  | {
      readonly kind: "APPLICATION_OPENED";
      readonly facts: { readonly application: "Safari" | "Finder" };
      readonly language?: ResponseLanguage;
    }
  | {
      readonly kind: "BATTERY_STATUS";
      readonly facts: {
        readonly percentage: number;
        readonly powerSource: "AC" | "BATTERY";
      };
      readonly language?: ResponseLanguage;
    }
  | {
      readonly kind: "CLARIFICATION" | "CONVERSATIONAL";
      readonly text: string;
      readonly language?: ResponseLanguage;
    }
  | {
      readonly kind: "ERROR";
      readonly reason: "ACTION_FAILED" | "GENERIC";
      readonly language?: ResponseLanguage;
    }
  | {
      readonly kind: "SECURITY_DENIAL";
      readonly reason: "IDENTITY_UNAUTHORIZED" | "IDENTITY_UNCERTAIN";
      readonly language?: ResponseLanguage;
    }
  | {
      readonly kind: "UNCERTAIN";
      readonly reason: "SPEECH" | "COMMAND";
      readonly language?: ResponseLanguage;
    };

export interface PersonalityOptions {
  readonly humorLevel?: HumorLevel;
  readonly variationSeed?: number;
  readonly maxCharacters?: number;
}

export interface PersonalityResponse {
  readonly category: ResponseCategory;
  readonly tone: PersonalityTone;
  readonly text: string;
  readonly facts: Readonly<Record<string, string | number>> | null;
  readonly speechRequest: SpeechRequest;
}

export interface PersonalityEngine {
  render(content: ResponseContent, options?: PersonalityOptions): PersonalityResponse;
}
