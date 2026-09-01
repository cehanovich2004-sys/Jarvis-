import { JarvisError } from "../errors.js";
import type { ToolExecutionResult } from "../tools/contracts.js";
import type { SpeechPlaybackResult } from "../tts/contracts.js";
import type {
  DeclinedVoiceInteractionResult,
  FailedVoiceInteractionResult,
  VoiceInteractionDependencies,
  VoiceInteractionRequest,
  VoiceInteractionResult,
  VoiceInteractionTerminalState
} from "./contracts.js";
import {
  DeterministicResponseGenerator,
  type InteractionResponseGenerator
} from "./responses.js";
import { ExclusiveActionExecutor } from "./exclusive-executor.js";
import { VoiceInteractionStateMachine } from "./state-machine.js";
import { isInteractionInterruption } from "./interruption-reason.js";

export class VoiceInteractionService {
  readonly #dependencies: VoiceInteractionDependencies;
  readonly #responses: InteractionResponseGenerator;

  constructor(
    dependencies: VoiceInteractionDependencies,
    responses: InteractionResponseGenerator = new DeterministicResponseGenerator()
  ) {
    this.#dependencies = {
      ...dependencies,
      actionExecutor: new ExclusiveActionExecutor(dependencies.actionExecutor)
    };
    this.#responses = responses;
  }

  async run(request: VoiceInteractionRequest): Promise<VoiceInteractionResult> {
    const machine = new VoiceInteractionStateMachine(request.onStateChange);
    const signal = request.signal;
    let execution: ToolExecutionResult | null = null;
    let responseText: string | null = null;
    try {
      throwIfAborted(signal);
      machine.transition("VERIFYING_SPEAKER");
      const identity = await awaitWithAbort(
        this.#dependencies.speakerRecognition.verifySpeaker(
          request.audio,
          request.ownerProfileId,
          signal
        ),
        signal
      );
      throwIfAborted(signal);
      notifyIdentity(request.onIdentity, identity);
      if (identity.status !== "AUTHORIZED") {
        return await this.#decline(
          machine,
          identity.status === "UNAUTHORIZED" ? "UNAUTHORIZED" : "UNCERTAIN_IDENTITY",
          signal
        );
      }

      machine.transition("TRANSCRIBING");
      const transcript = await awaitWithAbort(
        this.#dependencies.speechToText.transcribe(
          request.audio,
          signal === undefined ? {} : { signal }
        ),
        signal
      );
      throwIfAborted(signal);
      if (transcript.status === "EMPTY") {
        return await this.#decline(machine, "NO_SPEECH", signal);
      }
      if (transcript.status === "UNCERTAIN") {
        return await this.#decline(machine, "UNCERTAIN_SPEECH", signal);
      }
      notifyTranscript(request.onTranscript, transcript.text, transcript.language);

      machine.transition("UNDERSTANDING");
      const routing = this.#dependencies.intentRouter.route(transcript);
      if (routing.status !== "MATCHED") {
        return await this.#decline(machine, "NO_MATCH", signal);
      }

      throwIfAborted(signal);
      machine.transition("EXECUTING");
      try {
        execution = await awaitWithAbort(
          this.#dependencies.actionExecutor.execute(routing.command, signal),
          signal
        );
      } catch (error) {
        if (signal?.aborted === true || isCancellation(error)) {
          throw error;
        }
        responseText = this.#responses.forExecutionFailure();
        machine.transition("RESPONDING");
        const playback = await this.#speak(responseText, signal);
        machine.finish("ERROR");
        return {
          state: "ERROR",
          transitions: machine.transitions,
          responseText,
          playback,
          execution: null,
          errorCode: "TOOL_EXECUTION_FAILED"
        };
      }
      throwIfAborted(signal);
      responseText = this.#responses.forExecution(execution);
      machine.transition("RESPONDING");
      const playback = await this.#speak(responseText, signal);
      if (execution.status === "FAILED") {
        machine.finish("ERROR");
        return {
          state: "ERROR",
          transitions: machine.transitions,
          responseText,
          playback,
          execution,
          errorCode: "TOOL_EXECUTION_FAILED"
        };
      }
      machine.finish("COMPLETE");
      return {
        state: "COMPLETE",
        transitions: machine.transitions,
        responseText,
        playback,
        execution
      };
    } catch (error) {
      if (isInteractionInterruption(signal?.reason) || isInteractionInterruption(error)) {
        finishAfterFailure(machine, "INTERRUPTED");
        return {
          state: "INTERRUPTED",
          transitions: machine.transitions,
          responseText,
          playback: null,
          execution
        };
      }
      if (signal?.aborted === true || isCancellation(error)) {
        finishAfterFailure(machine, "CANCELLED");
        return {
          state: "CANCELLED",
          transitions: machine.transitions,
          responseText,
          playback: null,
          execution
        };
      }
      finishAfterFailure(machine, "ERROR");
      return failedResult(machine, responseText, execution);
    }
  }

  async #decline(
    machine: VoiceInteractionStateMachine,
    state: DeclinedVoiceInteractionResult["state"],
    signal: AbortSignal | undefined
  ): Promise<DeclinedVoiceInteractionResult> {
    const responseText = this.#responses.forAlternateState(state);
    machine.transition("RESPONDING");
    const playback = await this.#speak(responseText, signal);
    machine.finish(state);
    return {
      state,
      transitions: machine.transitions,
      responseText,
      playback,
      execution: null
    };
  }

  #speak(text: string, signal: AbortSignal | undefined): Promise<SpeechPlaybackResult> {
    return awaitWithAbort(
      this.#dependencies.textToSpeech.speak(
        { text, language: "RU" },
        signal === undefined ? {} : { signal }
      ),
      signal
    );
  }
}

function notifyTranscript(
  observer: VoiceInteractionRequest["onTranscript"],
  text: string,
  language: string | undefined
): void {
  try {
    observer?.(text, language);
  } catch {
    // Diagnostic observation cannot alter routing or security behavior.
  }
}

function notifyIdentity(
  observer: VoiceInteractionRequest["onIdentity"],
  result: import("../voiceid/contracts.js").SpeakerVerificationResult
): void {
  try {
    observer?.(result);
  } catch {
    // Diagnostic observation cannot alter identity or security behavior.
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason ?? new Error("Voice interaction was cancelled.");
  }
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Voice interaction was cancelled."));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason ?? new Error("Voice interaction was cancelled."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function isCancellation(error: unknown): boolean {
  return (
    error instanceof JarvisError &&
    (error.code === "STT_CANCELLED" || error.code === "TTS_CANCELLED")
  );
}

function finishAfterFailure(
  machine: VoiceInteractionStateMachine,
  state: "INTERRUPTED" | "CANCELLED" | "ERROR"
): void {
  if (machine.state !== state) {
    machine.finish(state);
  }
}

function failedResult(
  machine: VoiceInteractionStateMachine,
  responseText: string | null,
  execution: ToolExecutionResult | null
): FailedVoiceInteractionResult {
  return {
    state: "ERROR",
    transitions: machine.transitions,
    responseText,
    playback: null,
    execution,
    errorCode: "INTERACTION_FAILED"
  };
}
