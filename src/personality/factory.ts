import { loadPersonalityConfig } from "./config.js";
import { DeterministicPersonalityEngine } from "./engine.js";

export function createPersonalityEngine(
  environment: NodeJS.ProcessEnv = process.env
): DeterministicPersonalityEngine {
  const config = loadPersonalityConfig(environment);
  return new DeterministicPersonalityEngine(config);
}
