import type { ContextValue } from "./contracts.js";

export function preferVerifiedLiveValue<T>(
  verifiedLive: T | undefined,
  remembered: T | undefined
): ContextValue<T> | undefined {
  if (verifiedLive !== undefined) return { source: "VERIFIED_LIVE", value: verifiedLive };
  if (remembered !== undefined) return { source: "LONG_TERM_MEMORY", value: remembered };
  return undefined;
}
