import { JarvisError } from "../errors.js";
import type {
  MemoryApprovalMetadata,
  MemoryCandidate,
  MemoryCategory,
  MemoryProvenance,
  MemoryQuery,
  MemoryRecord,
  MemoryStoreLimits,
  MemoryWriteApproval
} from "./contracts.js";

const CATEGORIES: ReadonlySet<string> = new Set([
  "USER_PREFERENCE",
  "USER_SETTING",
  "PROJECT_FACT",
  "RELATIONSHIP_CONTEXT",
  "WORKFLOW_PREFERENCE"
]);
const PROVENANCE: ReadonlySet<string> = new Set([
  "EXPLICIT_USER_INPUT",
  "EXPLICIT_USER_CONFIGURATION"
]);
const FORBIDDEN_KEY = /(?:password|passwd|passcode|secret|token|api.?key|authorization|cookie|credential|private.?key|audio|recording|waveform|embedding|voiceprint|speaker.?profile|transcript|biometric|passport|ssn|credit.?card|account.?number)/iu;
const SECRET_VALUE = /(?:\b(?:password|passwd|passcode|secret|token|api[_ -]?key|authorization|cookie)\s*[:=]\s*\S+|\bBearer\s+\S+|\b(?:sk-(?:proj-)?|ghp_|github_pat_|glpat-|xox[baprs]-)[A-Za-z0-9_-]{12,}|\bAIza[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/iu;
const ENCODED_BLOB = /^(?:data:audio\/|[A-Za-z0-9+/]{100,}={0,2}$)/u;
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u;

export function validateMemoryCandidate(value: unknown): MemoryCandidate {
  const input = record(value);
  exact(input, ["category", "key", "source", "value"]);
  if (!CATEGORIES.has(String(input.category))) throw invalidMemory();
  const key = normalizeKey(input.key);
  const memoryValue = normalizeValue(input.value);
  const source = validateProvenance(input.source);
  return {
    category: input.category as MemoryCategory,
    key,
    value: memoryValue,
    source
  };
}

export function validateMemoryApproval(value: unknown): MemoryWriteApproval {
  try {
    const approval = record(value);
    exact(approval, ["actor", "approvalId", "status"]);
    if (approval.status !== "APPROVED" || approval.actor !== "USER") throw approvalRequired();
    return { status: "APPROVED", actor: "USER", approvalId: validateReferenceId(approval.approvalId) };
  } catch {
    throw new JarvisError("MEMORY_APPROVAL_REQUIRED", 403, "Explicit user approval is required.");
  }
}

export function validateMemoryRecord(value: unknown): MemoryRecord {
  const input = record(value);
  exact(input, ["approval", "category", "createdAt", "id", "key", "source", "updatedAt", "value", "version"]);
  const candidate = validateMemoryCandidate({
    category: input.category,
    key: input.key,
    source: input.source,
    value: input.value
  });
  const approval = validateApprovalMetadata(input.approval);
  const createdAt = validateTimestamp(input.createdAt);
  const updatedAt = validateTimestamp(input.updatedAt);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw invalidMemory();
  if (!Number.isSafeInteger(input.version) || Number(input.version) <= 0) throw invalidMemory();
  return {
    ...candidate,
    id: validateIdentifier(input.id),
    approval,
    createdAt,
    updatedAt,
    version: Number(input.version)
  };
}

export function validateMemoryQuery(value: MemoryQuery): Required<Pick<MemoryQuery, "limit">> & MemoryQuery {
  const input = record(value);
  const keys = [
    ...(input.categories === undefined ? [] : ["categories"]),
    ...(input.key === undefined ? [] : ["key"]),
    ...(input.limit === undefined ? [] : ["limit"])
  ];
  exact(input, keys);
  const limit = input.limit === undefined ? 20 : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 50) throw invalidMemory();
  let categories: readonly MemoryCategory[] | undefined;
  if (input.categories !== undefined) {
    if (!Array.isArray(input.categories) || input.categories.length === 0 || input.categories.length > CATEGORIES.size) throw invalidMemory();
    if (input.categories.some((category) => !CATEGORIES.has(String(category)))) throw invalidMemory();
    categories = [...new Set(input.categories as MemoryCategory[])];
  }
  const key = input.key === undefined ? undefined : normalizeKey(input.key);
  return { limit, ...(categories === undefined ? {} : { categories }), ...(key === undefined ? {} : { key }) };
}

export function validateMemoryLimits(limits: MemoryStoreLimits): MemoryStoreLimits {
  if (
    !Number.isSafeInteger(limits.maxRecords) || limits.maxRecords <= 0 || limits.maxRecords > 10_000 ||
    !Number.isSafeInteger(limits.maxTotalCharacters) || limits.maxTotalCharacters <= 0 || limits.maxTotalCharacters > 10_000_000
  ) throw invalidMemory();
  return { ...limits };
}

export function validateMemoryId(value: unknown): string {
  return validateIdentifier(value);
}

export function checkMemorySignal(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new JarvisError("MEMORY_CANCELLED", 499, "Memory operation was cancelled.");
  }
}

function validateProvenance(value: unknown): MemoryProvenance {
  const source = record(value);
  exact(source, ["kind", "referenceId"]);
  if (!PROVENANCE.has(String(source.kind))) throw invalidMemory();
  return {
    kind: source.kind as MemoryProvenance["kind"],
    referenceId: validateReferenceId(source.referenceId)
  };
}

function validateApprovalMetadata(value: unknown): MemoryApprovalMetadata {
  const approval = record(value);
  exact(approval, ["actor", "approvalId", "approvedAt", "status"]);
  const base = validateMemoryApproval({
    actor: approval.actor,
    approvalId: approval.approvalId,
    status: approval.status
  });
  return { ...base, approvedAt: validateTimestamp(approval.approvedAt) };
}

function normalizeKey(value: unknown): string {
  if (typeof value !== "string") throw invalidMemory();
  const key = value.normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/u.test(key) || FORBIDDEN_KEY.test(key)) throw invalidMemory();
  return key;
}

function normalizeValue(value: unknown): string {
  if (typeof value !== "string") throw invalidMemory();
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    normalized.length === 0 || normalized.length > 500 || CONTROL.test(normalized) ||
    SECRET_VALUE.test(normalized) || ENCODED_BLOB.test(normalized) || containsSensitiveNumber(normalized)
  ) {
    throw invalidMemory();
  }
  return normalized;
}

function validateIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/u.test(value)) throw invalidMemory();
  return value;
}

function validateReferenceId(value: unknown): string {
  const identifier = validateIdentifier(value);
  if (FORBIDDEN_KEY.test(identifier) || SECRET_VALUE.test(identifier)) throw invalidMemory();
  return identifier;
}

function validateTimestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw invalidMemory();
  return value;
}

function containsSensitiveNumber(value: string): boolean {
  if (/\b\d{3}-\d{2}-\d{4}\b/u.test(value)) return true;
  const candidates = value.match(/(?:\d[ -]?){13,19}/gu) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/gu, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let double = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (double) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      double = !double;
    }
    return sum % 10 === 0;
  });
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidMemory();
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) throw invalidMemory();
}

function invalidMemory(): JarvisError {
  return new JarvisError("MEMORY_INVALID", 422, "Memory data is invalid.");
}

function approvalRequired(): JarvisError {
  return new JarvisError("MEMORY_APPROVAL_REQUIRED", 403, "Explicit user approval is required.");
}
