import { JarvisError } from "../errors.js";
import type { IntelligenceDirectives, IntelligenceMode } from "./contracts.js";

const LOCAL_HINTS = [
  /(?:^|\s)только\s+локально(?=$|[\s,.:;!?-])/giu,
  /\blocal\s+only\b/giu
];
const CLOUD_HINTS = [
  /(?:^|\s)спроси\s+(?:gpt|джипити|старшего)(?=$|[\s,.:;!?-])/giu,
  /\bask\s+(?:gpt|the\s+senior)\b/giu
];
const MAX_HINTS = [
  /(?:^|\s)используй\s+максимальн(?:ый|ую)\s+интеллект(?=$|[\s,.:;!?-])/giu,
  /(?:^|\s)максимальн(?:ый|ая)\s+интеллект(?=$|[\s,.:;!?-])/giu,
  /\bmaximum\s+intelligence\b/giu
];
const COMPLEX_HINTS = [
  /(?:^|\s)(?:глубок(?:ий|о)|подробн(?:ый|о))\s+анализ(?=$|[\s,.:;!?-])/iu,
  /(?:^|\s)сложн(?:ый|ое)\s+(?:анализ|рассуждение)(?=$|[\s,.:;!?-])/iu,
  /\b(?:deep|complex)\s+(?:analysis|reasoning)\b/iu
];

export function parseIntelligenceDirectives(
  value: string,
  defaultMode: IntelligenceMode = "HYBRID"
): IntelligenceDirectives {
  if (!new Set(["LOCAL", "HYBRID", "MAX"]).has(defaultMode) || typeof value !== "string") {
    throw invalidInput();
  }
  const normalized = normalize(value);
  if (normalized.length === 0 || normalized.length > 4_096) throw invalidInput();
  const localOnly = matches(normalized, LOCAL_HINTS);
  const maximum = matches(normalized, MAX_HINTS);
  const explicitCloudRequest = !localOnly && (maximum || matches(normalized, CLOUD_HINTS));
  const mode = localOnly ? "LOCAL" : maximum ? "MAX" : defaultMode;
  const complexReasoning = matches(normalized, COMPLEX_HINTS);
  const text = normalize(strip(normalized, [...LOCAL_HINTS, ...CLOUD_HINTS, ...MAX_HINTS]))
    .replace(/^[,.:;!?\s-]+|[,.:;!?\s-]+$/gu, "")
    .trim();
  return { mode, text, explicitCloudRequest, complexReasoning };
}

function matches(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern.source, pattern.flags).test(value));
}

function strip(value: string, patterns: readonly RegExp[]): string {
  return patterns.reduce(
    (text, pattern) => text.replace(new RegExp(pattern.source, pattern.flags), " "),
    value
  );
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function invalidInput(): JarvisError {
  return new JarvisError("CLOUD_INVALID_RESPONSE", 422, "Intelligence directive is invalid.");
}
