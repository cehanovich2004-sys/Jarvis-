import { JarvisError } from "../errors.js";
import type {
  HumorLevel,
  PersonalityEngine,
  PersonalityOptions,
  PersonalityResponse,
  PersonalityTone,
  ResponseCategory,
  ResponseContent,
  ResponseLanguage
} from "./contracts.js";

export class DeterministicPersonalityEngine implements PersonalityEngine {
  readonly #defaultHumorLevel: HumorLevel;
  readonly #defaultMaxCharacters: number;

  constructor(options: { readonly humorLevel?: HumorLevel; readonly maxCharacters?: number } = {}) {
    this.#defaultHumorLevel = options.humorLevel ?? 2;
    this.#defaultMaxCharacters = options.maxCharacters ?? 500;
    validateOptions(this.#defaultHumorLevel, 0, this.#defaultMaxCharacters);
  }

  render(content: ResponseContent, options: PersonalityOptions = {}): PersonalityResponse {
    validateContent(content);
    const humorLevel = options.humorLevel ?? this.#defaultHumorLevel;
    const seed = options.variationSeed ?? stableSeed(content);
    const maxCharacters = options.maxCharacters ?? this.#defaultMaxCharacters;
    validateOptions(humorLevel, seed, maxCharacters);
    const language = content.language ?? "RU";
    const category = categoryFor(content);
    const neutral = neutralText(content, language);
    const allowedTone = category === "SUCCESS" || category === "INFORMATIONAL" || category === "CONVERSATIONAL";
    const tone = allowedTone ? selectTone(humorLevel, seed) : "NEUTRAL";
    const styled = tone === "NEUTRAL" ? neutral : `${neutral} ${suffix(language, tone)}`;
    const text = styled.length <= maxCharacters ? styled : neutral;
    if (text.length > maxCharacters) throw invalidContent();
    const facts = factsFor(content);
    return {
      category,
      tone: text === styled ? tone : "NEUTRAL",
      text,
      facts,
      speechRequest: { text, language }
    };
  }
}

function categoryFor(content: ResponseContent): ResponseCategory {
  if (content.kind === "APPLICATION_OPENED") return "SUCCESS";
  if (content.kind === "BATTERY_STATUS") return "INFORMATIONAL";
  if (content.kind === "CLARIFICATION") return "CLARIFICATION";
  if (content.kind === "CONVERSATIONAL") return "CONVERSATIONAL";
  return content.kind;
}

function neutralText(content: ResponseContent, language: ResponseLanguage): string {
  if (content.kind === "APPLICATION_OPENED") {
    return language === "RU" ? `${content.facts.application} открыт.` : `${content.facts.application} is open.`;
  }
  if (content.kind === "BATTERY_STATUS") {
    const power = content.facts.powerSource === "AC"
      ? language === "RU" ? "Питание от сети." : "Connected to AC power."
      : language === "RU" ? "Питание от батареи." : "Running on battery power.";
    return language === "RU"
      ? `Заряд батареи ${content.facts.percentage} процентов. ${power}`
      : `Battery charge is ${content.facts.percentage} percent. ${power}`;
  }
  if (content.kind === "CLARIFICATION" || content.kind === "CONVERSATIONAL") return content.text;
  if (content.kind === "ERROR") {
    return language === "RU"
      ? content.reason === "ACTION_FAILED" ? "Не удалось выполнить команду." : "Произошла ошибка."
      : content.reason === "ACTION_FAILED" ? "The command could not be completed." : "An error occurred.";
  }
  if (content.kind === "SECURITY_DENIAL") {
    return language === "RU"
      ? content.reason === "IDENTITY_UNAUTHORIZED"
        ? "Я не могу подтвердить голос владельца."
        : "Я не уверен, что это голос владельца."
      : content.reason === "IDENTITY_UNAUTHORIZED"
        ? "I cannot verify the owner's voice."
        : "I am not certain this is the owner's voice.";
  }
  if (content.kind === "UNCERTAIN") {
    return language === "RU"
      ? content.reason === "SPEECH" ? "Не удалось уверенно распознать речь." : "Команда не распознана."
      : content.reason === "SPEECH" ? "I could not recognize the speech confidently." : "The command was not recognized.";
  }
  throw invalidContent();
}

function selectTone(level: HumorLevel, seed: number): PersonalityTone {
  if (level === 0) return "NEUTRAL";
  const bucket = Math.abs(seed) % 20;
  if (level === 1) return bucket === 19 ? "LIGHT_IRONY" : "NEUTRAL";
  if (level === 2) return bucket < 16 ? "NEUTRAL" : bucket < 19 ? "LIGHT_IRONY" : "NOTICEABLE_HUMOR";
  return bucket < 10 ? "NEUTRAL" : bucket < 17 ? "LIGHT_IRONY" : "NOTICEABLE_HUMOR";
}

function suffix(language: ResponseLanguage, tone: Exclude<PersonalityTone, "NEUTRAL">): string {
  if (language === "RU") {
    return tone === "LIGHT_IRONY" ? "Всё подозрительно штатно." : "Техника сегодня решила сотрудничать.";
  }
  return tone === "LIGHT_IRONY" ? "Suspiciously routine." : "Technology has chosen cooperation today.";
}

function factsFor(content: ResponseContent): Readonly<Record<string, string | number>> | null {
  if (content.kind === "APPLICATION_OPENED") return { application: content.facts.application };
  if (content.kind === "BATTERY_STATUS") {
    return { percentage: content.facts.percentage, powerSource: content.facts.powerSource };
  }
  return null;
}

function validateContent(content: ResponseContent): void {
  if (typeof content !== "object" || content === null) throw invalidContent();
  const languageKeys = content.language === undefined ? [] : ["language"];
  if (content.language !== undefined && content.language !== "RU" && content.language !== "EN") throw invalidContent();
  if (content.kind === "APPLICATION_OPENED") {
    exact(content, ["facts", "kind", ...languageKeys]);
    exact(content.facts, ["application"]);
    if (content.facts.application !== "Safari" && content.facts.application !== "Finder") throw invalidContent();
    return;
  }
  if (content.kind === "BATTERY_STATUS") {
    exact(content, ["facts", "kind", ...languageKeys]);
    exact(content.facts, ["percentage", "powerSource"]);
    if (!Number.isInteger(content.facts.percentage) || content.facts.percentage < 0 || content.facts.percentage > 100 || !new Set(["AC", "BATTERY"]).has(content.facts.powerSource)) throw invalidContent();
    return;
  }
  if (content.kind === "CLARIFICATION" || content.kind === "CONVERSATIONAL") {
    exact(content, ["kind", "text", ...languageKeys]);
    if (typeof content.text !== "string" || content.text.trim().length === 0 || content.text.length > 1_000 || /[\u0000-\u001F\u007F-\u009F]/u.test(content.text)) throw invalidContent();
    return;
  }
  exact(content, ["kind", "reason", ...languageKeys]);
  const valid = content.kind === "ERROR"
    ? new Set(["ACTION_FAILED", "GENERIC"]).has(content.reason)
    : content.kind === "SECURITY_DENIAL"
      ? new Set(["IDENTITY_UNAUTHORIZED", "IDENTITY_UNCERTAIN"]).has(content.reason)
      : content.kind === "UNCERTAIN" && new Set(["SPEECH", "COMMAND"]).has(content.reason);
  if (!valid) throw invalidContent();
}

function exact(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) throw invalidContent();
}

function validateOptions(level: number, seed: number, maxCharacters: number): void {
  if (!Number.isSafeInteger(level) || level < 0 || level > 3 || !Number.isSafeInteger(seed) || !Number.isSafeInteger(maxCharacters) || maxCharacters <= 0 || maxCharacters > 1_000) {
    throw new JarvisError("PERSONALITY_INVALID_CONFIG", 500, "Personality configuration is invalid.");
  }
}

function stableSeed(content: ResponseContent): number {
  const value = JSON.stringify(content);
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function invalidContent(): JarvisError {
  return new JarvisError("PERSONALITY_INVALID_CONTENT", 422, "Response content is invalid.");
}
