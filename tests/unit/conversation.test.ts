import assert from "node:assert/strict";
import test from "node:test";
import { JarvisError } from "../../src/errors.js";
import {
  ConversationContextBuilder,
  DeterministicConversationResolver,
  InMemoryConversationSessionStore,
  type ConversationTurnInput
} from "../../src/conversation/index.js";

function turn(userText: string, assistantText = "Готово."): ConversationTurnInput {
  return {
    userText,
    assistantText,
    outcome: {
      kind: "INTENT",
      command: { intent: "OPEN_APPLICATION", parameters: { application: "Safari" }, confidence: 1 }
    },
    tool: { intent: "OPEN_APPLICATION", status: "SUCCESS", application: "Safari" },
    metadata: { source: "DETERMINISTIC", interactionState: "COMPLETE" }
  };
}

test("creates an explicit session and returns immutable structured snapshots", async () => {
  const store = new InMemoryConversationSessionStore({ ttlMilliseconds: 1_000, maxTurns: 4, maxCharacters: 1_000, now: () => 100 });
  const created = await store.create("session-main");
  assert.equal(created.sessionId, "session-main");
  assert.deepEqual(created.turns, []);
  const appended = await store.append("session-main", turn("Открой Safari"));
  assert.equal(appended.turns[0]?.sequence, 1);
  (appended.turns as unknown as unknown[]).length = 0;
  assert.equal((await store.get("session-main"))?.turns.length, 1);
  assert.equal("audio" in (await store.get("session-main"))!, false);
  assert.equal("embeddings" in (await store.get("session-main"))!, false);
  await assert.rejects(store.create("session-main"), hasCode("CONVERSATION_INVALID"));
});

test("evicts oldest turns deterministically by count and character budget", async () => {
  const byCount = new InMemoryConversationSessionStore({ ttlMilliseconds: 1_000, maxTurns: 2, maxCharacters: 1_000, now: () => 100 });
  await byCount.create("session-count");
  await Promise.all(["one", "two", "three"].map((value) => byCount.append("session-count", turn(value))));
  assert.deepEqual((await byCount.get("session-count"))?.turns.map((item) => item.sequence), [2, 3]);

  const byCharacters = new InMemoryConversationSessionStore({ ttlMilliseconds: 1_000, maxTurns: 10, maxCharacters: 20, now: () => 100 });
  await byCharacters.create("session-chars");
  await byCharacters.append("session-chars", turn("12345", "12345"));
  await byCharacters.append("session-chars", turn("67890", "67890"));
  await byCharacters.append("session-chars", turn("abcde", "abcde"));
  assert.deepEqual((await byCharacters.get("session-chars"))?.turns.map((item) => item.sequence), [2, 3]);
});

test("expires at the exact TTL boundary and supports explicit end", async () => {
  let now = 100;
  const store = new InMemoryConversationSessionStore({ ttlMilliseconds: 50, maxTurns: 2, maxCharacters: 100, now: () => now });
  await store.create("session-ttl");
  now = 150;
  assert.equal(await store.get("session-ttl"), undefined);
  await assert.rejects(store.append("session-ttl", turn("safe")), hasCode("CONVERSATION_NOT_FOUND"));
  await store.create("session-end");
  assert.equal(await store.delete("session-end"), true);
  assert.equal(await store.get("session-end"), undefined);
});

test("expired append reports expiration and removes the session", async () => {
  let now = 10;
  const store = new InMemoryConversationSessionStore({ ttlMilliseconds: 10, maxTurns: 2, maxCharacters: 100, now: () => now });
  await store.create("session-expired");
  now = 20;
  await assert.rejects(store.append("session-expired", turn("safe")), hasCode("CONVERSATION_EXPIRED"));
  assert.equal(await store.get("session-expired"), undefined);
});

test("pre-cancelled and sensitive writes fail without mutating the session", async () => {
  const store = new InMemoryConversationSessionStore({ ttlMilliseconds: 1_000, maxTurns: 4, maxCharacters: 1_000 });
  await store.create("session-safe");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(store.append("session-safe", turn("safe"), controller.signal), hasCode("CONVERSATION_CANCELLED"));
  for (const text of ["token=secret", "password: hunter2", "x\u0000y"]) {
    await assert.rejects(store.append("session-safe", turn(text)), hasCode("CONVERSATION_INVALID"));
  }
  await assert.rejects(store.append("session-safe", { ...turn("safe"), outcome: null } as never), hasCode("CONVERSATION_INVALID"));
  await assert.rejects(
    store.append("session-safe", { ...turn("safe"), rawAudio: [0.1, -0.1] } as never),
    hasCode("CONVERSATION_INVALID")
  );
  await assert.rejects(
    store.append("session-safe", {
      ...turn("safe"),
      metadata: { source: "DETERMINISTIC", embedding: [1, 2, 3] }
    } as never),
    hasCode("CONVERSATION_INVALID")
  );
  await assert.rejects(
    store.append("session-safe", {
      ...turn("safe"),
      outcome: {
        kind: "INTENT",
        command: {
          intent: "GET_BATTERY",
          parameters: {},
          confidence: 1,
          secret: "do-not-store"
        }
      }
    } as never),
    hasCode("CONVERSATION_INVALID")
  );
  await assert.rejects(
    store.append("session-safe", {
      ...turn("safe"),
      outcome: { kind: "ANSWER" },
      tool: { intent: "GET_BATTERY", status: "SUCCESS", percentage: 10, powerSource: "AC" }
    }),
    hasCode("CONVERSATION_INVALID")
  );
  assert.equal((await store.get("session-safe"))?.turns.length, 0);
});

test("context builder is bounded and prioritizes recent structured outcomes", async () => {
  const store = new InMemoryConversationSessionStore({ ttlMilliseconds: 1_000, maxTurns: 5, maxCharacters: 1_000, now: () => 100 });
  await store.create("session-context");
  await store.append("session-context", turn("old question", "old answer"));
  await store.append("session-context", {
    userText: "Какой заряд?",
    assistantText: "Заряд батареи 25 процентов. Питание от сети.",
    outcome: { kind: "INTENT", command: { intent: "GET_BATTERY", parameters: {}, confidence: 1 } },
    tool: { intent: "GET_BATTERY", status: "SUCCESS", percentage: 25, powerSource: "AC" },
    metadata: { source: "DETERMINISTIC" }
  });
  const snapshot = (await store.get("session-context"))!;
  const context = new ConversationContextBuilder({ maxCharacters: 180, maxTurns: 2 }).build(
    snapshot, "Подключён к сети?"
  );
  assert.equal(context.length <= 180, true);
  assert.match(context, /battery=25; power=AC/u);
  assert.equal(context.includes("old question"), false);
  assert.throws(
    () => new ConversationContextBuilder({ maxCharacters: 20 }).build(snapshot, "x".repeat(30)),
    hasCode("CONVERSATION_INVALID")
  );
});

test("deterministic resolver handles bounded application and battery follow-ups", async () => {
  const store = new InMemoryConversationSessionStore({ ttlMilliseconds: 1_000, maxTurns: 5, maxCharacters: 1_000, now: () => 100 });
  await store.create("session-resolve");
  await store.append("session-resolve", turn("Открой Safari"));
  const resolver = new DeterministicConversationResolver();
  assert.deepEqual(resolver.resolve("Теперь Finder.", (await store.get("session-resolve"))!), {
    kind: "INTENT_PROPOSAL",
    command: { intent: "OPEN_APPLICATION", parameters: { application: "Finder" }, confidence: 1 }
  });
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof JarvisError && error.code === code;
}
