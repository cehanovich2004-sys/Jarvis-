const interruptionReasons = new WeakSet<object>();

export function createInteractionInterruption(): object {
  const reason = Object.freeze({ name: "VoiceInteractionInterrupted" });
  interruptionReasons.add(reason);
  return reason;
}

export function isInteractionInterruption(value: unknown): boolean {
  return typeof value === "object" && value !== null && interruptionReasons.has(value);
}
