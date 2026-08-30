import { JarvisError } from "../errors.js";
import type { LocalLLMRuntimeClient, LocalLLMRuntimeResult } from "./runtime.js";

const MAX_RUNTIME_RESPONSE_BYTES = 65_536;

export interface OllamaRuntimeOptions {
  readonly endpoint: string;
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly fetch?: typeof globalThis.fetch;
}

export class OllamaRuntimeClient implements LocalLLMRuntimeClient {
  readonly metadata;
  readonly #endpoint: URL;
  readonly #model: string;
  readonly #maxOutputTokens: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: OllamaRuntimeOptions) {
    this.#endpoint = validateEndpoint(options.endpoint);
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(options.model)) throw invalidConfiguration();
    if (!Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens <= 0) {
      throw invalidConfiguration();
    }
    this.#model = options.model;
    this.#maxOutputTokens = options.maxOutputTokens;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.metadata = { backend: "ollama", model: options.model };
  }

  async generate(prompt: string, signal?: AbortSignal): Promise<LocalLLMRuntimeResult> {
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.#model,
          prompt,
          stream: false,
          keep_alive: "5m",
          format: OUTPUT_SCHEMA,
          options: { temperature: 0, num_predict: this.#maxOutputTokens }
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
        errorCode: response.status === 404 || response.status === 503 ? "MODEL_UNAVAILABLE" : "INFERENCE_FAILED"
      };
    }
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_RUNTIME_RESPONSE_BYTES) {
      return { status: "INVALID", errorCode: "INFERENCE_FAILED" };
    }
    const body = await readBounded(response, MAX_RUNTIME_RESPONSE_BYTES);
    if (body === undefined) return { status: "INVALID", errorCode: "INFERENCE_FAILED" };
    try {
      const parsed: unknown = JSON.parse(body);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("response" in parsed) ||
        typeof parsed.response !== "string" ||
        !("done" in parsed) ||
        parsed.done !== true
      ) {
        return { status: "INVALID", errorCode: "INFERENCE_FAILED" };
      }
      return { status: "VALID", output: parsed.response };
    } catch {
      return { status: "INVALID", errorCode: "INFERENCE_FAILED" };
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

async function readBounded(response: Response, maxBytes: number): Promise<string | undefined> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
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
      url.protocol !== "http:" ||
      !new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname) ||
      url.pathname !== "/api/generate" ||
      url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== ""
    ) throw invalidConfiguration();
    return url;
  } catch (error) {
    if (error instanceof JarvisError) throw error;
    throw invalidConfiguration();
  }
}

function invalidConfiguration(): JarvisError {
  return new JarvisError("LLM_MODEL_UNAVAILABLE", 503, "Local LLM configuration is invalid.");
}
