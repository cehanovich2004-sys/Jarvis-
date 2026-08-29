import type { AllowedApplication, IntentKind, StructuredCommand } from "../intents/contracts.js";

export type SafeMacOSOperation =
  | { readonly kind: "OPEN_APPLICATION"; readonly application: AllowedApplication }
  | { readonly kind: "VERIFY_APPLICATION"; readonly application: AllowedApplication }
  | { readonly kind: "GET_BATTERY" };

export interface SafeMacOSOperationResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export interface SafeMacOSOperationRunner {
  run(operation: SafeMacOSOperation, signal?: AbortSignal): Promise<SafeMacOSOperationResult>;
}

export type ToolExecutionResult =
  | {
      readonly status: "SUCCESS";
      readonly intent: "OPEN_APPLICATION";
      readonly verified: true;
      readonly data: { readonly application: AllowedApplication; readonly running: true };
    }
  | {
      readonly status: "SUCCESS";
      readonly intent: "GET_BATTERY";
      readonly verified: true;
      readonly data: { readonly percentage: number; readonly powerSource: "AC" | "BATTERY" };
    }
  | {
      readonly status: "FAILED";
      readonly intent: IntentKind;
      readonly verified: false;
      readonly data: null;
    };

export interface RegisteredTool {
  readonly intent: IntentKind;
  execute(command: StructuredCommand, signal?: AbortSignal): Promise<ToolExecutionResult>;
}
