import type { AudioData } from "../audio/contracts.js";
import type { IntentRouter } from "../intents/contracts.js";
import type { SpeechToTextServiceContract } from "../stt/contracts.js";
import type { ToolExecutionResult } from "../tools/contracts.js";
import type {
  SpeechPlaybackResult,
  TextToSpeechServiceContract
} from "../tts/contracts.js";
import type { SpeakerVerificationResult } from "../voiceid/contracts.js";

export type VoiceInteractionState =
  | "START"
  | "VERIFYING_SPEAKER"
  | "TRANSCRIBING"
  | "UNDERSTANDING"
  | "EXECUTING"
  | "RESPONDING"
  | "COMPLETE"
  | "UNAUTHORIZED"
  | "UNCERTAIN_IDENTITY"
  | "NO_SPEECH"
  | "UNCERTAIN_SPEECH"
  | "NO_MATCH"
  | "CANCELLED"
  | "ERROR";

export type VoiceInteractionTerminalState =
  | "COMPLETE"
  | "UNAUTHORIZED"
  | "UNCERTAIN_IDENTITY"
  | "NO_SPEECH"
  | "UNCERTAIN_SPEECH"
  | "NO_MATCH"
  | "CANCELLED"
  | "ERROR";

export interface SpeakerVerificationPort {
  verifySpeaker(
    audio: AudioData,
    profileId: string,
    signal?: AbortSignal
  ): Promise<SpeakerVerificationResult>;
}

export interface ActionExecutorPort {
  execute(
    command: import("../intents/contracts.js").StructuredCommand,
    signal?: AbortSignal
  ): Promise<ToolExecutionResult>;
}

export interface VoiceInteractionDependencies {
  readonly speakerRecognition: SpeakerVerificationPort;
  readonly speechToText: SpeechToTextServiceContract;
  readonly intentRouter: IntentRouter;
  readonly actionExecutor: ActionExecutorPort;
  readonly textToSpeech: TextToSpeechServiceContract;
}

export interface VoiceInteractionRequest {
  readonly audio: AudioData;
  readonly ownerProfileId: string;
  readonly signal?: AbortSignal;
}

interface VoiceInteractionResultBase {
  readonly state: VoiceInteractionTerminalState;
  readonly transitions: readonly VoiceInteractionState[];
  readonly responseText: string | null;
  readonly playback: SpeechPlaybackResult | null;
  readonly execution: ToolExecutionResult | null;
}

export interface CompletedVoiceInteractionResult extends VoiceInteractionResultBase {
  readonly state: "COMPLETE";
  readonly responseText: string;
  readonly playback: SpeechPlaybackResult;
  readonly execution: Extract<ToolExecutionResult, { readonly status: "SUCCESS" }>;
}

export interface DeclinedVoiceInteractionResult extends VoiceInteractionResultBase {
  readonly state:
    | "UNAUTHORIZED"
    | "UNCERTAIN_IDENTITY"
    | "NO_SPEECH"
    | "UNCERTAIN_SPEECH"
    | "NO_MATCH";
  readonly responseText: string;
  readonly playback: SpeechPlaybackResult;
  readonly execution: null;
}

export interface CancelledVoiceInteractionResult extends VoiceInteractionResultBase {
  readonly state: "CANCELLED";
  readonly responseText: string | null;
  readonly playback: null;
  readonly execution: ToolExecutionResult | null;
}

export interface FailedVoiceInteractionResult extends VoiceInteractionResultBase {
  readonly state: "ERROR";
  readonly errorCode: "INTERACTION_FAILED" | "TOOL_EXECUTION_FAILED";
}

export type VoiceInteractionResult =
  | CompletedVoiceInteractionResult
  | DeclinedVoiceInteractionResult
  | CancelledVoiceInteractionResult
  | FailedVoiceInteractionResult;
