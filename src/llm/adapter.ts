import { performance } from "node:perf_hooks";
import { JarvisError } from "../errors.js";
import { validateStructuredCommand } from "../intents/validation.js";
import type { StructuredCommand } from "../intents/contracts.js";
import {
  DEFAULT_MAX_LLM_INPUT_CHARACTERS,
  DEFAULT_MAX_LLM_OUTPUT_CHARACTERS,
  type LocalIntelligenceResult,
  type LocalLLMMetadata,
  type LocalLLMOptions,
  type LocalLLMProvider
} from "./contracts.js";
import type { LocalLLMRuntimeClient } from "./runtime.js";

export interface LocalLLMAdapterOptions {
  readonly timeoutMilliseconds?: number;
  readonly maxInputCharacters?: number;
  readonly maxOutputCharacters?: number;
}

export class ValidatedLocalLLMProvider implements LocalLLMProvider {
  readonly #runtime: LocalLLMRuntimeClient;
  readonly #metadata: LocalLLMMetadata;
  readonly #timeoutMilliseconds: number;
  readonly #maxInputCharacters: number;
  readonly #maxOutputCharacters: number;

  constructor(runtime: LocalLLMRuntimeClient, options: LocalLLMAdapterOptions = {}) {
    this.#runtime = runtime;
    this.#metadata = validateMetadata(runtime.metadata);
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 30_000;
    this.#maxInputCharacters = options.maxInputCharacters ?? DEFAULT_MAX_LLM_INPUT_CHARACTERS;
    this.#maxOutputCharacters = options.maxOutputCharacters ?? DEFAULT_MAX_LLM_OUTPUT_CHARACTERS;
    for (const value of [
      this.#timeoutMilliseconds,
      this.#maxInputCharacters,
      this.#maxOutputCharacters
    ]) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw invalidResponse();
      }
    }
  }

  async interpret(input: string, options: LocalLLMOptions = {}): Promise<LocalIntelligenceResult> {
    const normalized = validateInput(input, this.#maxInputCharacters);
    const startedAt = performance.now();
    let output: string;
    try {
      const result = await runBounded(
        (signal) => this.#runtime.generate(buildPrompt(normalized), signal),
        this.#timeoutMilliseconds,
        options.signal
      );
      if (result.status === "INVALID") {
        if (result.errorCode === "MODEL_UNAVAILABLE") {
          throw new JarvisError("LLM_MODEL_UNAVAILABLE", 503, "Local language model is unavailable.");
        }
        throw runtimeFailure();
      }
      output = result.output;
    } catch (error) {
      if (error instanceof CancelledError) {
        throw new JarvisError("LLM_CANCELLED", 499, "Local intelligence request was cancelled.");
      }
      if (error instanceof TimeoutError) {
        throw new JarvisError("LLM_TIMEOUT", 504, "Local intelligence request timed out.");
      }
      if (error instanceof JarvisError) {
        throw error;
      }
      throw runtimeFailure();
    }
    return parseOutput(output, finiteElapsed(startedAt), this.#metadata, this.#maxOutputCharacters);
  }
}

function validateInput(value: unknown, maxCharacters: number): string {
  if (typeof value !== "string") {
    throw invalidInput();
  }
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const sensitive = /(?:api[_-]?key|password|passwd|secret|authorization|bearer|token)\s*[:=]\s*\S+/iu;
  if (
    normalized.length === 0 ||
    normalized.length > maxCharacters ||
    /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u.test(normalized) ||
    sensitive.test(normalized)
  ) {
    throw invalidInput();
  }
  return normalized;
}

function buildPrompt(input: string): string {
  return [
    "Classify the user input. Return JSON only.",
    "Allowed kinds: ANSWER, INTENT_PROPOSAL, NO_RESULT.",
    "Intent proposals may only be OPEN_APPLICATION for Safari/Finder or GET_BATTERY.",
    "Never output shell commands, executable names, paths, URLs, secrets, or tool instructions.",
    `User input: ${JSON.stringify(input)}`
  ].join("\n");
}

function parseOutput(
  output: unknown,
  latencyMs: number,
  metadata: LocalLLMMetadata,
  maxCharacters: number
): LocalIntelligenceResult {
  if (typeof output !== "string" || output.length === 0 || output.length > maxCharacters) {
    throw invalidResponse();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw invalidResponse();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalidResponse();
  }
  const value = parsed as Record<string, unknown>;
  if (value.kind === "NO_RESULT" && exactKeys(value, ["kind"])) {
    return { kind: "NO_RESULT", latencyMs, metadata: { ...metadata } };
  }
  if (value.kind === "ANSWER" && exactKeys(value, ["kind", "text"])) {
    const text = validateAnswer(value.text, maxCharacters);
    return { kind: "ANSWER", text, latencyMs, metadata: { ...metadata } };
  }
  if (value.kind === "INTENT_PROPOSAL" && exactKeys(value, ["kind", "command"])) {
    try {
      validateStructuredCommand(value.command as never);
    } catch {
      throw invalidResponse();
    }
    return {
      kind: "INTENT_PROPOSAL",
      command: value.command as StructuredCommand,
      latencyMs,
      metadata: { ...metadata }
    };
  }
  throw invalidResponse();
}

function validateAnswer(value: unknown, maxCharacters: number): string {
  if (typeof value !== "string") {
    throw invalidResponse();
  }
  const text = value.replace(/\s+/gu, " ").trim();
  if (text.length === 0 || text.length > maxCharacters || /[\u0000-\u001F\u007F-\u009F]/u.test(text)) {
    throw invalidResponse();
  }
  return text;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function validateMetadata(value: LocalLLMMetadata): LocalLLMMetadata {
  if (!safeIdentifier(value.backend) || !safeIdentifier(value.model)) {
    throw invalidResponse();
  }
  return { ...value };
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,128}$/.test(value);
}

function finiteElapsed(startedAt: number): number {
  const value = performance.now() - startedAt;
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function invalidInput(): JarvisError {
  return new JarvisError("LLM_INVALID_INPUT", 422, "Local intelligence input is invalid.");
}
function invalidResponse(): JarvisError {
  return new JarvisError("LLM_INVALID_RESPONSE", 502, "Local model returned an invalid response.");
}
function runtimeFailure(): JarvisError {
  return new JarvisError("LLM_RUNTIME_FAILURE", 502, "Local intelligence request failed.");
}

class TimeoutError extends Error {}
class CancelledError extends Error {}

async function runBounded<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  external?: AbortSignal
): Promise<T> {
  if (external?.aborted === true) throw new CancelledError();
  const controller = new AbortController();
  let reason: "TIMEOUT" | "CANCELLED" | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      if (reason !== undefined) return;
      reason = "TIMEOUT";
      controller.abort();
      reject(new TimeoutError());
    }, timeoutMs);
  });
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      if (reason !== undefined) return;
      reason = "CANCELLED";
      controller.abort();
      reject(new CancelledError());
    };
    external?.addEventListener("abort", onAbort, { once: true });
  });
  const running = Promise.resolve().then(() => operation(controller.signal));
  try {
    return await Promise.race([running, timeout, cancelled]);
  } catch (error) {
    if (reason === "CANCELLED") throw new CancelledError();
    if (reason === "TIMEOUT") throw new TimeoutError();
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) external?.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
