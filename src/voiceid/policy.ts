import { JarvisError } from "../errors.js";
import type { SpeakerDecision, SpeakerDecisionPolicy } from "./contracts.js";

export interface ThresholdDecisionPolicyOptions {
  readonly authorizedThreshold: number;
  readonly unauthorizedThreshold: number;
  readonly policyId: string;
}

export class ThresholdDecisionPolicy implements SpeakerDecisionPolicy {
  readonly policyId: string;
  readonly calibrationRequired = true;
  readonly #authorizedThreshold: number;
  readonly #unauthorizedThreshold: number;

  constructor(options: ThresholdDecisionPolicyOptions) {
    if (
      !isSimilarity(options.authorizedThreshold) ||
      !isSimilarity(options.unauthorizedThreshold) ||
      options.unauthorizedThreshold >= options.authorizedThreshold ||
      !isPolicyId(options.policyId)
    ) {
      throw new JarvisError(
        "SPEAKER_VERIFICATION_FAILURE",
        500,
        "Speaker decision policy is invalid."
      );
    }
    this.#authorizedThreshold = options.authorizedThreshold;
    this.#unauthorizedThreshold = options.unauthorizedThreshold;
    this.policyId = options.policyId;
  }

  decide(similarities: readonly number[]): SpeakerDecision {
    if (similarities.length === 0 || !similarities.every(isSimilarity)) {
      throw new JarvisError(
        "SPEAKER_VERIFICATION_FAILURE",
        502,
        "Speaker verification failed."
      );
    }
    const similarity = Math.max(...similarities);
    const status =
      similarity >= this.#authorizedThreshold
        ? "AUTHORIZED"
        : similarity <= this.#unauthorizedThreshold
          ? "UNAUTHORIZED"
          : "UNCERTAIN";
    return {
      status,
      similarity,
      authorizedThreshold: this.#authorizedThreshold,
      unauthorizedThreshold: this.#unauthorizedThreshold
    };
  }
}

function isSimilarity(value: number): boolean {
  return Number.isFinite(value) && value >= -1 && value <= 1;
}

function isPolicyId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value);
}
