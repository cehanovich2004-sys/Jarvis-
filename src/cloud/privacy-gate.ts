import { JarvisError } from "../errors.js";
import type {
  CloudRequestCandidate,
  PrivacyApprovedCloudRequest,
  SelectedCloudContext
} from "./contracts.js";

const approvedRequests = new WeakSet<object>();
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u;
const SECRET = /(?:\b(?:password|passwd|passcode|secret|token|api[_ -]?key|authorization|cookie|credential)\s*[:=]\s*\S+|\bBearer\s+\S+|\b(?:sk-(?:proj-)?|ghp_|github_pat_|glpat-|xox[baprs]-)[A-Za-z0-9_-]{12,}|\bAIza[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/iu;
const PRIVATE_MATERIAL = /(?:raw\s+audio|voice\s*id|voiceid|voice\s+embedding|speaker\s+embedding|speaker\s+profile|voiceprint|biometric|waveform|data:audio\/)/iu;
const FILESYSTEM_PATH = /(?:^|[\s"'(])(?:\/(?!\/)(?:[^\s/]+\/)*[^\s/]+|[A-Za-z]:\\\S+)/u;
const ENVIRONMENT = /(?:\$\{?[A-Z_][A-Z0-9_]*\}?|\b[A-Z_][A-Z0-9_]{2,}\s*=\s*\S+)/u;
const ENCODED_BLOB = /\b[A-Za-z0-9+/]{100,}={0,2}\b/u;

export interface PrivacyGateOptions {
  readonly maxInputCharacters?: number;
  readonly maxContextItems?: number;
  readonly maxContextCharacters?: number;
  readonly maxTotalCharacters?: number;
}

export class PrivacyGate {
  readonly #maxInputCharacters: number;
  readonly #maxContextItems: number;
  readonly #maxContextCharacters: number;
  readonly #maxTotalCharacters: number;

  constructor(options: PrivacyGateOptions = {}) {
    this.#maxInputCharacters = options.maxInputCharacters ?? 2_000;
    this.#maxContextItems = options.maxContextItems ?? 2;
    this.#maxContextCharacters = options.maxContextCharacters ?? 1_000;
    this.#maxTotalCharacters = options.maxTotalCharacters ?? 3_000;
    for (const value of [this.#maxInputCharacters, this.#maxContextItems, this.#maxContextCharacters, this.#maxTotalCharacters]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw rejected();
    }
  }

  approve(candidate: CloudRequestCandidate): PrivacyApprovedCloudRequest {
    const value = exactCandidate(candidate);
    const input = safeText(value.input, this.#maxInputCharacters);
    if (!Array.isArray(value.context) || value.context.length > this.#maxContextItems) throw rejected();
    const context = value.context.map((item) => validateContext(item));
    const contextCharacters = context.reduce((total, item) => total + item.text.length, 0);
    if (contextCharacters > this.#maxContextCharacters || contextCharacters + input.length > this.#maxTotalCharacters) throw rejected();
    const approved = Object.freeze({
      mode: value.mode,
      escalationReason: value.escalationReason,
      input,
      context: Object.freeze(context.map((item) => Object.freeze(item))),
      privacyStatus: "APPROVED" as const
    });
    approvedRequests.add(approved);
    return approved;
  }
}

export function isPrivacyApprovedRequest(value: unknown): value is PrivacyApprovedCloudRequest {
  return typeof value === "object" && value !== null && approvedRequests.has(value);
}

export function isSafeCloudText(value: string, maxCharacters: number): boolean {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return (
    normalized.length > 0 && normalized.length <= maxCharacters && !CONTROL.test(normalized) &&
    !SECRET.test(normalized) && !PRIVATE_MATERIAL.test(normalized) && !FILESYSTEM_PATH.test(normalized) &&
    !ENVIRONMENT.test(normalized) && !ENCODED_BLOB.test(normalized)
  );
}

function exactCandidate(value: CloudRequestCandidate): CloudRequestCandidate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw rejected();
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "context,escalationReason,input,mode") throw rejected();
  if (!new Set(["LOCAL", "HYBRID", "MAX"]).has(value.mode)) throw rejected();
  if (!new Set([
    "LOCAL_MODEL_UNAVAILABLE",
    "LOCAL_LOW_CONFIDENCE",
    "COMPLEX_REASONING",
    "REPEATED_LOCAL_FAILURE",
    "EXPLICIT_USER_REQUEST"
  ]).has(value.escalationReason)) throw rejected();
  return value;
}

function validateContext(value: SelectedCloudContext): SelectedCloudContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw rejected();
  if (Object.keys(value).sort().join(",") !== "source,text" || value.source !== "SHORT_TERM_CONTEXT") throw rejected();
  return { source: "SHORT_TERM_CONTEXT", text: safeText(value.text, 1_000) };
}

function safeText(value: unknown, maxCharacters: number): string {
  if (typeof value !== "string") throw rejected();
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!isSafeCloudText(normalized, maxCharacters)) throw rejected();
  return normalized;
}

function rejected(): JarvisError {
  return new JarvisError("CLOUD_PRIVACY_REJECTED", 403, "Cloud request was rejected by privacy policy.");
}
