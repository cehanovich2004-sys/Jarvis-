import type { AudioSession } from "../audio/session.js";
import { JarvisError } from "../errors.js";
import { VoiceInteractionCoordinator } from "../interaction/coordinator.js";
import type { VoiceInteractionResult } from "../interaction/contracts.js";
import type { LiveVoiceResult, LiveVoiceRunOptions, LiveVoiceState } from "./contracts.js";

export type AudioSessionFactory = () => AudioSession;

export class LiveVoiceMode {
  readonly #audioSessionFactory: AudioSessionFactory;
  readonly #coordinator: VoiceInteractionCoordinator;
  readonly #ownerProfileId: string;
  #interactionSequence = 0;
  #running = false;

  constructor(
    audioSessionFactory: AudioSessionFactory,
    coordinator: VoiceInteractionCoordinator,
    ownerProfileId: string
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/u.test(ownerProfileId)) {
      throw new JarvisError("SPEAKER_PROFILE_NOT_FOUND", 404, "Owner speaker profile was not found.");
    }
    this.#audioSessionFactory = audioSessionFactory;
    this.#coordinator = coordinator;
    this.#ownerProfileId = ownerProfileId;
  }

  async runOneShot(options: LiveVoiceRunOptions = {}): Promise<LiveVoiceResult> {
    if (this.#running) {
      throw new JarvisError("LIVE_VOICE_BUSY", 409, "A live voice session is already active.");
    }
    this.#running = true;
    let audioDurationSeconds: number | null = null;
    try {
      notify(options.onStateChange, "LISTENING");
      const captured = await this.#audioSessionFactory().run(
        options.signal,
        options.onVoiceActivity
      );
      if (captured.state !== "COMPLETE") {
        const state = captured.state === "TIMEOUT" ? "NO_SPEECH" : "CANCELLED";
        notify(options.onStateChange, state);
        return { state, audioDurationSeconds: null, interaction: null };
      }
      audioDurationSeconds = captured.audio.durationSeconds;
      this.#interactionSequence += 1;
      const interaction = await this.#coordinator.start({
        interactionId: `live-${this.#interactionSequence}`,
        audio: captured.audio,
        ownerProfileId: this.#ownerProfileId,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.onStateChange === undefined
          ? {}
          : { onStateChange: (state) => notify(options.onStateChange, state) }),
        ...(options.onTranscript === undefined ? {} : { onTranscript: options.onTranscript }),
        ...(options.onIdentity === undefined ? {} : { onIdentity: options.onIdentity })
      });
      return resultForInteraction(interaction, audioDurationSeconds);
    } catch (error) {
      if (options.signal?.aborted === true) {
        notify(options.onStateChange, "CANCELLED");
        return { state: "CANCELLED", audioDurationSeconds: null, interaction: null };
      }
      notify(options.onStateChange, "ERROR");
      return {
        state: "ERROR",
        audioDurationSeconds,
        interaction: null,
        errorCode: error instanceof JarvisError ? error.code : "INTERNAL_ERROR"
      };
    } finally {
      this.#running = false;
    }
  }
}

function resultForInteraction(
  interaction: VoiceInteractionResult,
  audioDurationSeconds: number
): LiveVoiceResult {
  if (interaction.state === "COMPLETE") {
    return { state: "COMPLETE", audioDurationSeconds, interaction };
  }
  if (interaction.state === "ERROR") {
    return {
      state: "ERROR",
      audioDurationSeconds,
      interaction,
      errorCode: interaction.errorCode
    };
  }
  return { state: interaction.state, audioDurationSeconds, interaction };
}

function notify(observer: ((state: LiveVoiceState) => void) | undefined, state: LiveVoiceState): void {
  try {
    observer?.(state);
  } catch {
    // Operational state reporting cannot alter capture or security behavior.
  }
}
