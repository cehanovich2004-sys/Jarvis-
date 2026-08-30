import { JarvisError } from "../errors.js";
import type { CloudLLMRuntimeClient, CloudRuntimeResult, CloudRuntimeUsage } from "./runtime.js";

const MAX_RESPONSE_BYTES = 65_536;

export interface OpenAICompatibleRuntimeOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly fetch?: typeof globalThis.fetch;
}

export class OpenAICompatibleCloudRuntime implements CloudLLMRuntimeClient {
  readonly metadata;
  readonly #endpoint: URL;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #maxOutputTokens: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: OpenAICompatibleRuntimeOptions) {
    this.#endpoint = validateEndpoint(options.endpoint);
    if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(options.model)) throw unavailable();
    if (
      typeof options.apiKey !== "string" || options.apiKey.length < 8 || options.apiKey.length > 512 ||
      /[\u0000-\u0020\u007F-\u009F]/u.test(options.apiKey) ||
      !Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens <= 0 || options.maxOutputTokens > 4_096
    ) throw unavailable();
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#maxOutputTokens = options.maxOutputTokens;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.metadata = { provider: "openai-compatible", model: options.model };
  }

  async generate(prompt: string, signal?: AbortSignal): Promise<CloudRuntimeResult> {
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.#apiKey}`
        },
        body: JSON.stringify({
          model: this.#model,
          messages: [{ role: "user", content: prompt }],
          response_format: {
            type: "json_schema",
            json_schema: { name: "jarvis_cloud_result", strict: true, schema: OUTPUT_SCHEMA }
          },
          temperature: 0,
          max_tokens: this.#maxOutputTokens
        }),
        ...(signal === undefined ? {} : { signal })
      });
    } catch (error) {
      if (signal?.aborted === true) throw error;
      return { status: "INVALID", errorCode: "MODEL_UNAVAILABLE" };
    }
    if (!response.ok) {
      return {
        status: "INVALID",
        errorCode: response.status === 404 || response.status === 429 || response.status === 503
          ? "MODEL_UNAVAILABLE"
          : "RUNTIME_FAILURE"
      };
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return runtimeFailureResult();
    const body = await readBounded(response, MAX_RESPONSE_BYTES);
    if (signal?.aborted === true) throw signal.reason ?? new Error("Cloud request aborted.");
    if (body === undefined) return runtimeFailureResult();
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return runtimeFailureResult();
      const value = parsed as Record<string, unknown>;
      if (!Array.isArray(value.choices) || value.choices.length !== 1) return runtimeFailureResult();
      const choice = value.choices[0];
      if (typeof choice !== "object" || choice === null || !("message" in choice)) return runtimeFailureResult();
      const message = choice.message;
      if (typeof message !== "object" || message === null || !("content" in message) || typeof message.content !== "string") {
        return runtimeFailureResult();
      }
      const usage = parseUsage(value.usage);
      return { status: "VALID", output: message.content, ...(usage === undefined ? {} : { usage }) };
    } catch {
      return runtimeFailureResult();
    }
  }
}

const OUTPUT_SCHEMA = {
  type: "object",
  oneOf: [
    {
      properties: { kind: { const: "ANSWER" }, text: { type: "string" } },
      required: ["kind", "text"],
      additionalProperties: false
    },
    {
      properties: {
        kind: { const: "INTENT_PROPOSAL" },
        command: {
          type: "object",
          properties: {
            intent: { enum: ["OPEN_APPLICATION", "GET_BATTERY"] },
            parameters: { type: "object" },
            confidence: { type: "number", minimum: 0, maximum: 1 }
          },
          required: ["intent", "parameters", "confidence"],
          additionalProperties: false
        }
      },
      required: ["kind", "command"],
      additionalProperties: false
    },
    {
      properties: { kind: { const: "NO_RESULT" } },
      required: ["kind"],
      additionalProperties: false
    }
  ]
} as const;

function parseUsage(value: unknown): CloudRuntimeUsage | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  if (!Number.isSafeInteger(usage.prompt_tokens) || !Number.isSafeInteger(usage.completion_tokens)) return undefined;
  const inputTokens = Number(usage.prompt_tokens);
  const outputTokens = Number(usage.completion_tokens);
  if (inputTokens < 0 || outputTokens < 0) return undefined;
  return { inputTokens, outputTokens };
}

async function readBounded(response: Response, maxBytes: number): Promise<string | undefined> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return undefined;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

function validateEndpoint(value: string): URL {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.pathname !== "/v1/chat/completions" ||
      url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" ||
      !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/u.test(url.hostname) ||
      url.hostname.endsWith(".local") || url.hostname === "localhost"
    ) throw unavailable();
    return url;
  } catch (error) {
    if (error instanceof JarvisError) throw error;
    throw unavailable();
  }
}

function runtimeFailureResult(): CloudRuntimeResult {
  return { status: "INVALID", errorCode: "RUNTIME_FAILURE" };
}

function unavailable(): JarvisError {
  return new JarvisError("CLOUD_MODEL_UNAVAILABLE", 503, "Cloud model configuration is unavailable.");
}
