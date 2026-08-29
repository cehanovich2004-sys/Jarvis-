import { JarvisError } from "../errors.js";
import type { STTBackendMetadata, STTLanguageMode } from "./contracts.js";
import type { STTAudioInput, STTRuntimeClient, STTRuntimeResult } from "./runtime.js";

const MAX_RESPONSE_BYTES = 1_048_576;

export interface WhisperCppRuntimeOptions {
  readonly endpoint: string;
  readonly model: string;
  readonly backendVersion?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export class WhisperCppRuntimeClient implements STTRuntimeClient {
  readonly metadata: STTBackendMetadata;
  readonly #endpoint: URL;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: WhisperCppRuntimeOptions) {
    this.#endpoint = validateLoopbackEndpoint(options.endpoint);
    if (!isSafeIdentifier(options.model)) {
      throw invalidConfiguration();
    }
    if (options.backendVersion !== undefined && !isSafeIdentifier(options.backendVersion)) {
      throw invalidConfiguration();
    }
    this.metadata = {
      backend: "whisper.cpp",
      ...(options.backendVersion === undefined ? {} : { backendVersion: options.backendVersion }),
      model: options.model
    };
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async transcribe(input: STTAudioInput, signal?: AbortSignal): Promise<STTRuntimeResult> {
    const form = new FormData();
    form.set("file", new Blob([encodePcm16Wav(input.waveform)], { type: "audio/wav" }), "audio.wav");
    form.set("response_format", "verbose_json");
    form.set("language", toWhisperLanguage(input.languageMode));
    form.set("detect_language", input.languageMode === "AUTO" ? "true" : "false");
    form.set("token_timestamps", "false");
    form.set("no_context", "true");

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        body: form,
        ...(signal === undefined ? {} : { signal })
      });
    } catch {
      return { status: "INVALID", errorCode: "MODEL_UNAVAILABLE" };
    }
    if (!response.ok) {
      return {
        status: "INVALID",
        errorCode: response.status === 503 ? "MODEL_UNAVAILABLE" : "INFERENCE_FAILED"
      };
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      return { status: "INVALID", errorCode: "INFERENCE_FAILED" };
    }
    const raw = await readBoundedBody(response, MAX_RESPONSE_BYTES);
    if (raw === undefined) {
      return { status: "INVALID", errorCode: "INFERENCE_FAILED" };
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || !("text" in parsed)) {
        return { status: "INVALID", errorCode: "INFERENCE_FAILED" };
      }
      const text = (parsed as { readonly text: unknown }).text;
      const language = readLanguage(parsed);
      const languageConfidence = readLanguageConfidence(parsed);
      if (typeof text !== "string") {
        return { status: "INVALID", errorCode: "INFERENCE_FAILED" };
      }
      return {
        status: text.trim() === "" ? "EMPTY" : "SUCCESS",
        text,
        ...(language === undefined ? {} : { language }),
        ...(languageConfidence === undefined ? {} : { languageConfidence })
      };
    } catch {
      return { status: "INVALID", errorCode: "INFERENCE_FAILED" };
    }
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string | undefined> {
  if (response.body === null) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        text += decoder.decode();
        return text;
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
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

export function encodePcm16Wav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const pcm = sample < 0 ? Math.round(sample * 32_768) : Math.round(sample * 32_767);
    view.setInt16(44 + index * 2, pcm, true);
  }
  return bytes;
}

function validateLoopbackEndpoint(value: string): URL {
  try {
    const url = new URL(value);
    const hosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
    if (
      url.protocol !== "http:" ||
      !hosts.has(url.hostname) ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw invalidConfiguration();
    }
    return url;
  } catch (error) {
    if (error instanceof JarvisError) {
      throw error;
    }
    throw invalidConfiguration();
  }
}

function toWhisperLanguage(mode: STTLanguageMode): string {
  return mode === "AUTO" ? "auto" : mode.toLowerCase();
}

function readLanguage(value: object): string | undefined {
  if ("language" in value && typeof value.language === "string") {
    const normalized = value.language.trim().toLowerCase();
    const map: Readonly<Record<string, string>> = { russian: "ru", english: "en" };
    return map[normalized] ?? normalized;
  }
  return undefined;
}

function readLanguageConfidence(value: object): number | undefined {
  if (
    "detected_language_probability" in value &&
    typeof value.detected_language_probability === "number"
  ) {
    return value.detected_language_probability;
  }
  return undefined;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value);
}

function invalidConfiguration(): JarvisError {
  return new JarvisError("STT_MODEL_UNAVAILABLE", 503, "Local STT runtime configuration is invalid.");
}
