import assert from "node:assert/strict";
import test from "node:test";
import { JarvisError } from "../../src/errors.js";
import {
  InMemoryLongTermMemoryStore,
  LongTermMemoryService,
  preferVerifiedLiveValue,
  type LongTermMemoryStore,
  type MemoryCandidate,
  type MemoryWriteApproval
} from "../../src/memory/index.js";

const LIMITS = { maxRecords: 3, maxTotalCharacters: 1_000 };
const APPROVAL: MemoryWriteApproval = {
  status: "APPROVED",
  actor: "USER",
  approvalId: "approval-1"
};

test("deliberate create records normalized data, provenance, consent, and version", async () => {
  const service = memoryService();
  const record = await service.create(
    { ...candidate(), value: "  Тёмная   тема  " },
    APPROVAL
  );
  assert.deepEqual(record, {
    ...candidate(),
    value: "Тёмная тема",
    id: "memory-1",
    approval: { ...APPROVAL, approvedAt: "2026-01-01T00:00:00.000Z" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1
  });
});

test("missing, denied, malformed, or forged approval fails before mutation", async () => {
  const store = new InMemoryLongTermMemoryStore(LIMITS);
  const service = memoryService(store);
  for (const approval of [
    undefined,
    { status: "DENIED", actor: "USER", approvalId: "approval-1" },
    { status: "APPROVED", actor: "SYSTEM", approvalId: "approval-1" },
    { status: "APPROVED", actor: "USER", approvalId: "ghp_12345678901234567890" },
    { ...APPROVAL, grantPermission: true }
  ]) {
    await assert.rejects(
      service.create(candidate(), approval as never),
      hasCode("MEMORY_APPROVAL_REQUIRED")
    );
  }
  assert.deepEqual(await store.list(), []);
});

test("privacy policy rejects credentials, auth material, biometrics, audio, transcripts, and blobs", async () => {
  const service = memoryService();
  const unsafe: MemoryCandidate[] = [
    { ...candidate(), key: "api_key" },
    { ...candidate(), key: "voice_embedding" },
    { ...candidate(), key: "meeting_transcript" },
    { ...candidate(), key: "passport_number" },
    { ...candidate(), value: "password=hunter2" },
    { ...candidate(), value: "Bearer abcdefghijklmnop" },
    { ...candidate(), value: "sk-proj-abcdefghijklmnop" },
    { ...candidate(), value: "ghp_12345678901234567890" },
    { ...candidate(), value: "xoxb-12345678901234567890" },
    { ...candidate(), value: "Карта 4111 1111 1111 1111" },
    { ...candidate(), value: "Идентификатор 123-45-6789" },
    { ...candidate(), value: "eyJabcdefgh.abcdefgh.abcdefgh" },
    { ...candidate(), value: "-----BEGIN PRIVATE KEY-----" },
    { ...candidate(), value: "A".repeat(120) },
    { ...candidate(), source: { ...candidate().source, referenceId: "secret-token-1" } }
  ];
  for (const input of unsafe) {
    await assert.rejects(service.create(input, APPROVAL), hasCode("MEMORY_INVALID"));
  }
});

test("duplicates conflict and optimistic updates require current version", async () => {
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const store = new InMemoryLongTermMemoryStore(LIMITS);
  const service = new LongTermMemoryService(store, {
    now: () => now,
    idFactory: sequence("memory-1", "memory-2")
  });
  const created = await service.create(candidate(), APPROVAL);
  await assert.rejects(service.create(candidate(), APPROVAL), hasCode("MEMORY_DUPLICATE"));
  now += 1_000;
  const updated = await service.update(
    created.id,
    1,
    { ...candidate(), value: "Светлая тема" },
    { ...APPROVAL, approvalId: "approval-2" }
  );
  assert.equal(updated.version, 2);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.updatedAt, "2026-01-01T00:00:01.000Z");
  assert.equal(updated.approval.approvedAt, updated.updatedAt);
  await assert.rejects(
    service.update(created.id, 1, candidate(), APPROVAL),
    hasCode("MEMORY_CONFLICT")
  );
  await assert.rejects(service.delete(created.id, 1), hasCode("MEMORY_CONFLICT"));
  assert.equal(await service.delete(created.id, 2), true);
  await assert.rejects(service.delete(created.id, 2), hasCode("MEMORY_NOT_FOUND"));
});

test("bounded store rejects overflow without damaging existing records", async () => {
  const store = new InMemoryLongTermMemoryStore({ maxRecords: 1, maxTotalCharacters: 40 });
  const service = new LongTermMemoryService(store, {
    now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    idFactory: sequence("memory-1", "memory-2")
  });
  const first = await service.create(candidate(), APPROVAL);
  await assert.rejects(
    service.create({ ...candidate(), key: "editor.theme" }, APPROVAL),
    hasCode("MEMORY_CAPACITY_EXCEEDED")
  );
  assert.deepEqual(await store.list(), [first]);
  await assert.rejects(
    service.update(
      first.id,
      1,
      { ...candidate(), value: "очень длинное предпочтение ".repeat(5) },
      APPROVAL
    ),
    hasCode("MEMORY_CAPACITY_EXCEEDED")
  );
  assert.deepEqual(await store.list(), [first]);
});

test("retrieval is bounded, filtered, deterministic, untrusted, and defensive", async () => {
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const store = new InMemoryLongTermMemoryStore({ maxRecords: 5, maxTotalCharacters: 1_000 });
  const service = new LongTermMemoryService(store, {
    now: () => now,
    idFactory: sequence("memory-1", "memory-2", "memory-3")
  });
  await service.create(candidate(), APPROVAL);
  now += 1_000;
  await service.create({ ...candidate(), category: "WORKFLOW_PREFERENCE", key: "editor.name", value: "Codex" }, APPROVAL);
  now += 1_000;
  await service.create({ ...candidate(), category: "PROJECT_FACT", key: "project.language", value: "TypeScript" }, APPROVAL);
  const result = await service.retrieve({ categories: ["USER_PREFERENCE", "WORKFLOW_PREFERENCE"], limit: 1 });
  assert.equal(result.trust, "UNTRUSTED_CONTEXT");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.key, "editor.name");
  (result.records[0] as { value: string }).value = "mutated";
  assert.equal((await service.retrieve({ key: "editor.name" })).records[0]?.value, "Codex");
});

test("cancellation is checked before every mutation", async () => {
  const store = new InMemoryLongTermMemoryStore(LIMITS);
  const service = memoryService(store);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(service.create(candidate(), APPROVAL, controller.signal), hasCode("MEMORY_CANCELLED"));
  assert.deepEqual(await store.list(), []);
});

test("verified live values always outrank stale remembered values", () => {
  assert.deepEqual(preferVerifiedLiveValue(25, 80), {
    source: "VERIFIED_LIVE",
    value: 25
  });
  assert.deepEqual(preferVerifiedLiveValue(undefined, 80), {
    source: "LONG_TERM_MEMORY",
    value: 80
  });
});

test("service treats malformed replaceable-store output as untrusted corruption", async () => {
  const malicious: LongTermMemoryStore = {
    async create(record) { return record; },
    async update(record) { return record; },
    async get() { return undefined; },
    async list() {
      return [{
        ...candidate(),
        value: "password=hunter2",
        id: "memory-1",
        approval: { ...APPROVAL, approvedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        version: 1
      }];
    },
    async delete() { return true; }
  };
  await assert.rejects(memoryService(malicious).retrieve(), hasCode("MEMORY_STORE_CORRUPT"));
});

function candidate(): MemoryCandidate {
  return {
    category: "USER_PREFERENCE",
    key: "interface.theme",
    value: "Тёмная тема",
    source: { kind: "EXPLICIT_USER_INPUT", referenceId: "turn-1" }
  };
}

function memoryService(
  store: LongTermMemoryStore = new InMemoryLongTermMemoryStore(LIMITS)
): LongTermMemoryService {
  return new LongTermMemoryService(store, {
    now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    idFactory: () => "memory-1"
  });
}

function sequence(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `memory-${index}`;
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof JarvisError && error.code === code;
}
