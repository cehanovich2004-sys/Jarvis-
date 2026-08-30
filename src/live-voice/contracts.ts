import type {
  VoiceInteractionResult,
  VoiceInteractionState,
  VoiceInteractionTerminalState
} from "../interaction/contracts.js";

export type LiveVoiceState = "IDLE" | "LISTENING" | VoiceInteractionState;

export interface LiveVoiceRunOptions {
  readonly signal?: AbortSignal;
  readonly onStateChange?: (state: LiveVoiceState) => void;
}

export type LiveVoiceResult =
  | {
      readonly state: "COMPLETE";
      readonly audioDurationSeconds: number;
      readonly interaction: VoiceInteractionResult;
    }
  | {
      readonly state: "NO_SPEECH" | "CANCELLED";
      readonly audioDurationSeconds: null;
      readonly interaction: null;
    }
  | {
      readonly state: Exclude<VoiceInteractionTerminalState, "COMPLETE" | "ERROR">;
      readonly audioDurationSeconds: number;
      readonly interaction: VoiceInteractionResult;
    }
  | {
      readonly state: "ERROR";
      readonly audioDurationSeconds: number | null;
      readonly interaction: VoiceInteractionResult | null;
      readonly errorCode: string;
    };
