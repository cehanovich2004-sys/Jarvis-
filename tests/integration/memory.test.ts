import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JarvisError } from "../../src/errors.js";
import {
  JsonFileLongTermMemoryStore,
  LongTermMemoryService,
  type MemoryCandidate,
  type MemoryWriteApproval
} from "../../src/memory/index.js";

const LIMITS = { maxRecords: 10, maxTotalCharacters: 5_000 };
const APPROVAL: MemoryWriteApproval = {
  status: "APPROVED",
  actor: "USER",
  approvalId: "approval-1"
};

test("atomic JSON store persists create, update, retrieval, and deletion across instances", async () => {
  await withStore(async (file) => {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const first = service(file, () => now, () => "memory-1");
    const created = await first.create(candidate(), APPROVAL);
    const second = service(file, () => now, () => "unused-1");
    assert.deepEqual((await second.retrieve()).records, [created]);
    now += 1_000;
    const updated = await second.update(
      created.id,
      1,
      { ...candidate(), value: "Светлая тема" },
      { ...APPROVAL, approvalId: "approval-2" }
    );
    const third = service(file, () => now, () => "unused-2");
    assert.equal((await third.retrieve()).records[0]?.value, "Светлая тема");
    assert.equal(await third.delete(updated.id, 2), true);
    assert.deepEqual((await service(file, () => now, () => "unused-3").retrieve()).records, []);

    const document = JSON.parse(await readFile(file, "utf8")) as { schemaVersion: number; records: unknown[] };
    assert.equal(document.schemaVersion, 1);
    assert.deepEqual(document.records, []);
    assert.equal((await lstat(file)).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(join(file, ".."))).filter((name) => name.endsWith(".tmp")), []);
  });
});

test("concurrent writes are serialized and duplicate category/key fails closed", async () => {
  await withStore(async (file) => {
    let id = 0;
    const memory = service(file, () => Date.parse("2026-01-01T00:00:00.000Z"), () => `memory-${++id}`);
    const results = await Promise.allSettled([
      memory.create(candidate(), APPROVAL),
      memory.create(candidate(), APPROVAL)
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(rejected?.status, "rejected");
    assert.equal(rejected?.status === "rejected" && rejected.reason instanceof JarvisError && rejected.reason.code, "MEMORY_DUPLICATE");
    assert.equal((await memory.retrieve()).records.length, 1);
  });
});

test("corruption and unknown schema fields are rejected without overwrite or content leakage", async () => {
  await withStore(async (file) => {
    const sensitive = "/private/user/path token=secret waveform=[0.1]";
    await writeFile(file, `{not-json ${sensitive}`, { mode: 0o600 });
    const before = await readFile(file, "utf8");
    await assert.rejects(service(file).retrieve(), safeCode("MEMORY_STORE_CORRUPT", sensitive));
    assert.equal(await readFile(file, "utf8"), before);

    await writeFile(file, JSON.stringify({ schemaVersion: 1, records: [], extra: sensitive }), { mode: 0o600 });
    await assert.rejects(service(file).retrieve(), safeCode("MEMORY_STORE_CORRUPT", sensitive));
  });
});

test("insecure file permissions and symlinks are rejected", async () => {
  await withStore(async (file, directory) => {
    await writeFile(file, JSON.stringify({ schemaVersion: 1, records: [] }), { mode: 0o600 });
    await chmod(file, 0o644);
    await assert.rejects(service(file).retrieve(), hasCode("MEMORY_STORE_UNSAFE"));

    const target = join(directory, "target.json");
    const link = join(directory, "linked.memory.json");
    await writeFile(target, JSON.stringify({ schemaVersion: 1, records: [] }), { mode: 0o600 });
    await symlink(target, link);
    await assert.rejects(service(link).retrieve(), hasCode("MEMORY_STORE_UNSAFE"));
  });
});

test("pre-cancelled persistent mutation creates no memory file", async () => {
  await withStore(async (file) => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      service(file).create(candidate(), APPROVAL, controller.signal),
      hasCode("MEMORY_CANCELLED")
    );
    await assert.rejects(lstat(file), (error: unknown) => isCode(error, "ENOENT"));
  });
});

test("persistent store rejects relative paths and unsafe parent permissions", async () => {
  assert.throws(
    () => new JsonFileLongTermMemoryStore("relative.memory.json", LIMITS),
    hasCode("MEMORY_INVALID")
  );
  const directory = await mkdtemp(join(tmpdir(), "jarvis-memory-open-"));
  try {
    await chmod(directory, 0o755);
    const file = join(directory, "memory.json");
    await assert.rejects(service(file).create(candidate(), APPROVAL), hasCode("MEMORY_STORE_UNSAFE"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function service(
  file: string,
  now: () => number = () => Date.parse("2026-01-01T00:00:00.000Z"),
  idFactory: () => string = () => "memory-1"
): LongTermMemoryService {
  return new LongTermMemoryService(new JsonFileLongTermMemoryStore(file, LIMITS), {
    now,
    idFactory
  });
}

function candidate(): MemoryCandidate {
  return {
    category: "USER_SETTING",
    key: "interface.theme",
    value: "Тёмная тема",
    source: { kind: "EXPLICIT_USER_CONFIGURATION", referenceId: "settings-1" }
  };
}

async function withStore(
  run: (file: string, directory: string) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-memory-test-"));
  try {
    await run(join(directory, "jarvis.memory.json"), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function safeCode(code: string, sensitive: string): (error: unknown) => boolean {
  return (error) => {
    assert.equal(JSON.stringify(error).includes(sensitive), false);
    assert.equal(String(error).includes("/private"), false);
    return error instanceof JarvisError && error.code === code;
  };
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof JarvisError && error.code === code;
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
