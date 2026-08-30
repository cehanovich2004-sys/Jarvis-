import { JarvisError } from "../errors.js";
import type { VoiceInteractionRequest, VoiceInteractionResult } from "./contracts.js";
import { createInteractionInterruption } from "./interruption-reason.js";
import { VoiceInteractionService } from "./service.js";

export interface CoordinatedVoiceInteractionRequest extends VoiceInteractionRequest {
  readonly interactionId: string;
}

interface ActiveInteraction {
  readonly id: string;
  readonly controller: AbortController;
  readonly result: Promise<VoiceInteractionResult>;
}

export class VoiceInteractionCoordinator {
  readonly #service: VoiceInteractionService;
  #active: ActiveInteraction | null = null;

  constructor(service: VoiceInteractionService) {
    this.#service = service;
  }

  get activeInteractionId(): string | null {
    return this.#active?.id ?? null;
  }

  start(request: CoordinatedVoiceInteractionRequest): Promise<VoiceInteractionResult> {
    validateInteractionId(request.interactionId);
    const predecessor = this.#active;
    predecessor?.controller.abort(createInteractionInterruption());

    const controller = new AbortController();
    const unlinkExternal = forwardAbort(request.signal, controller);
    let active: ActiveInteraction;
    const result = (predecessor?.result ?? Promise.resolve())
      .catch(() => undefined)
      .then(() =>
        this.#service.run({
          audio: request.audio,
          ownerProfileId: request.ownerProfileId,
          signal: controller.signal
        })
      )
      .finally(() => {
        unlinkExternal();
        if (this.#active === active) this.#active = null;
      });
    active = { id: request.interactionId, controller, result };
    this.#active = active;
    return result;
  }

  interruptActive(): boolean {
    if (this.#active === null) return false;
    this.#active.controller.abort(createInteractionInterruption());
    return true;
  }
}

function forwardAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (source === undefined) return () => undefined;
  const abort = (): void => target.abort(source.reason);
  if (source.aborted) {
    abort();
    return () => undefined;
  }
  source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

function validateInteractionId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new JarvisError("INTERACTION_INVALID_ID", 422, "Interaction ID is invalid.");
  }
}
