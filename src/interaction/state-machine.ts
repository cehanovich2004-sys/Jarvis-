import type { VoiceInteractionState, VoiceInteractionTerminalState } from "./contracts.js";

const TERMINAL_STATES: ReadonlySet<VoiceInteractionState> = new Set([
  "COMPLETE",
  "UNAUTHORIZED",
  "UNCERTAIN_IDENTITY",
  "NO_SPEECH",
  "UNCERTAIN_SPEECH",
  "NO_MATCH",
  "CANCELLED",
  "ERROR"
]);

const ALLOWED_TRANSITIONS: Readonly<Record<VoiceInteractionState, readonly VoiceInteractionState[]>> =
  {
    START: ["VERIFYING_SPEAKER", "CANCELLED", "ERROR"],
    VERIFYING_SPEAKER: ["TRANSCRIBING", "RESPONDING", "CANCELLED", "ERROR"],
    TRANSCRIBING: ["UNDERSTANDING", "RESPONDING", "CANCELLED", "ERROR"],
    UNDERSTANDING: ["EXECUTING", "RESPONDING", "CANCELLED", "ERROR"],
    EXECUTING: ["RESPONDING", "CANCELLED", "ERROR"],
    RESPONDING: [
      "COMPLETE",
      "UNAUTHORIZED",
      "UNCERTAIN_IDENTITY",
      "NO_SPEECH",
      "UNCERTAIN_SPEECH",
      "NO_MATCH",
      "CANCELLED",
      "ERROR"
    ],
    COMPLETE: [],
    UNAUTHORIZED: [],
    UNCERTAIN_IDENTITY: [],
    NO_SPEECH: [],
    UNCERTAIN_SPEECH: [],
    NO_MATCH: [],
    CANCELLED: [],
    ERROR: []
  };

export class VoiceInteractionStateMachine {
  #state: VoiceInteractionState = "START";
  readonly #transitions: VoiceInteractionState[] = ["START"];

  get state(): VoiceInteractionState {
    return this.#state;
  }

  get transitions(): readonly VoiceInteractionState[] {
    return [...this.#transitions];
  }

  transition(next: VoiceInteractionState): void {
    if (!ALLOWED_TRANSITIONS[this.#state].includes(next)) {
      throw new Error(`Invalid voice interaction transition: ${this.#state} -> ${next}`);
    }
    this.#state = next;
    this.#transitions.push(next);
  }

  finish(state: VoiceInteractionTerminalState): void {
    if (!TERMINAL_STATES.has(state)) {
      throw new Error("Voice interaction must finish in a terminal state.");
    }
    this.transition(state);
  }
}
