import assert from "node:assert/strict";
import test from "node:test";
import { JarvisError } from "../../src/errors.js";
import {
  DeterministicPersonalityEngine,
  loadPersonalityConfig,
  type PersonalityTone,
  type ResponseContent
} from "../../src/personality/index.js";

test("NORMAL humor distribution is deterministic at 80/15/5", () => {
  const engine = new DeterministicPersonalityEngine();
  const counts: Record<PersonalityTone, number> = {
    NEUTRAL: 0,
    LIGHT_IRONY: 0,
    NOTICEABLE_HUMOR: 0
  };
  for (let seed = 0; seed < 20; seed += 1) {
    counts[engine.render(application(), { humorLevel: 2, variationSeed: seed }).tone] += 1;
  }
  assert.deepEqual(counts, { NEUTRAL: 16, LIGHT_IRONY: 3, NOTICEABLE_HUMOR: 1 });
});

test("security denial, errors, uncertainty, and clarification are always restrained", () => {
  const engine = new DeterministicPersonalityEngine();
  const contents: ResponseContent[] = [
    { kind: "SECURITY_DENIAL", reason: "IDENTITY_UNAUTHORIZED" },
    { kind: "SECURITY_DENIAL", reason: "IDENTITY_UNCERTAIN" },
    { kind: "ERROR", reason: "ACTION_FAILED" },
    { kind: "ERROR", reason: "GENERIC" },
    { kind: "UNCERTAIN", reason: "SPEECH" },
    { kind: "UNCERTAIN", reason: "COMMAND" },
    { kind: "CLARIFICATION", text: "Уточните команду." }
  ];
  for (const content of contents) {
    const result = engine.render(content, { humorLevel: 3, variationSeed: 19 });
    assert.equal(result.tone, "NEUTRAL");
    assert.equal(result.text.includes("сотрудничать"), false);
    assert.equal(result.text.includes("штатно"), false);
  }
});

test("factual values remain exact across every humor level and tone", () => {
  const engine = new DeterministicPersonalityEngine();
  for (const humorLevel of [0, 1, 2, 3] as const) {
    for (const variationSeed of [0, 16, 19]) {
      const battery = engine.render(
        { kind: "BATTERY_STATUS", facts: { percentage: 25, powerSource: "AC" } },
        { humorLevel, variationSeed }
      );
      assert.deepEqual(battery.facts, { percentage: 25, powerSource: "AC" });
      assert.match(battery.text, /25/u);
      assert.match(battery.text, /Питание от сети/u);
      (battery.facts as Record<string, string | number>).percentage = 99;
      const repeated = engine.render(
        { kind: "BATTERY_STATUS", facts: { percentage: 25, powerSource: "AC" } },
        { humorLevel, variationSeed }
      );
      assert.equal(repeated.facts?.percentage, 25);
    }
  }
});

test("supports RU-first and explicit English speech requests", () => {
  const engine = new DeterministicPersonalityEngine({ humorLevel: 0 });
  assert.deepEqual(engine.render(application()).speechRequest, {
    text: "Safari открыт.", language: "RU"
  });
  assert.deepEqual(engine.render({ ...application(), language: "EN" }).speechRequest, {
    text: "Safari is open.", language: "EN"
  });
});

test("length control falls back to neutral and never truncates facts", () => {
  const engine = new DeterministicPersonalityEngine();
  const neutral = engine.render(application(), {
    humorLevel: 3,
    variationSeed: 19,
    maxCharacters: 20
  });
  assert.equal(neutral.text, "Safari открыт.");
  assert.equal(neutral.tone, "NEUTRAL");
  assert.throws(
    () => engine.render({ kind: "CONVERSATIONAL", text: "x".repeat(30) }, { maxCharacters: 20 }),
    hasCode("PERSONALITY_INVALID_CONTENT")
  );
});

test("forged commands, extra fields, invalid facts, controls, and configuration fail closed", () => {
  const engine = new DeterministicPersonalityEngine();
  for (const content of [
    { ...application(), command: { intent: "SHELL" } },
    { kind: "BATTERY_STATUS", facts: { percentage: 101, powerSource: "AC" } },
    { kind: "CONVERSATIONAL", text: "hello\u0000world" },
    { kind: "SECURITY_DENIAL", reason: "ALLOW_ANYWAY" }
  ]) {
    assert.throws(() => engine.render(content as never), hasCode("PERSONALITY_INVALID_CONTENT"));
  }
  assert.throws(() => new DeterministicPersonalityEngine({ humorLevel: 4 as never }), hasCode("PERSONALITY_INVALID_CONFIG"));
});

test("loads NORMAL as the default configurable humor level", () => {
  assert.deepEqual(loadPersonalityConfig({}), { humorLevel: 2, maxCharacters: 500 });
  assert.deepEqual(loadPersonalityConfig({ JARVIS_HUMOR_LEVEL: "0", JARVIS_RESPONSE_MAX_CHARACTERS: "120" }), {
    humorLevel: 0,
    maxCharacters: 120
  });
});

function application(): ResponseContent {
  return { kind: "APPLICATION_OPENED", facts: { application: "Safari" } };
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof JarvisError && error.code === code;
}
