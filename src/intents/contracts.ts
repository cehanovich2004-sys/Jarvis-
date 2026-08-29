import type { TranscriptResult } from "../stt/contracts.js";

export type IntentKind = "OPEN_APPLICATION" | "GET_BATTERY";
export type AllowedApplication = "Safari" | "Finder";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type StructuredCommand =
  | {
      readonly intent: "OPEN_APPLICATION";
      readonly parameters: { readonly application: AllowedApplication };
      readonly confidence: number;
    }
  | {
      readonly intent: "GET_BATTERY";
      readonly parameters: Readonly<Record<string, never>>;
      readonly confidence: number;
    };

export type IntentRoutingResult =
  | { readonly status: "MATCHED"; readonly command: StructuredCommand }
  | { readonly status: "NO_MATCH"; readonly command: null }
  | { readonly status: "UNCERTAIN"; readonly command: null };

export interface IntentRouter {
  route(transcript: TranscriptResult): IntentRoutingResult;
}

export interface PermissionDecision {
  readonly risk: RiskLevel;
  readonly allowed: boolean;
  readonly confirmationRequired: boolean;
}
