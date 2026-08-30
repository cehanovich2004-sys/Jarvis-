import { JarvisError } from "../errors.js";
import type { HumorLevel } from "./contracts.js";

export interface PersonalityConfig {
  readonly humorLevel: HumorLevel;
  readonly maxCharacters: number;
}

export function loadPersonalityConfig(environment: NodeJS.ProcessEnv = process.env): PersonalityConfig {
  const humorLevel = Number(environment.JARVIS_HUMOR_LEVEL ?? "2");
  const maxCharacters = Number(environment.JARVIS_RESPONSE_MAX_CHARACTERS ?? "500");
  if (
    !Number.isSafeInteger(humorLevel) || humorLevel < 0 || humorLevel > 3 ||
    !Number.isSafeInteger(maxCharacters) || maxCharacters <= 0 || maxCharacters > 1_000
  ) {
    throw new JarvisError("PERSONALITY_INVALID_CONFIG", 500, "Personality configuration is invalid.");
  }
  return { humorLevel: humorLevel as HumorLevel, maxCharacters };
}
