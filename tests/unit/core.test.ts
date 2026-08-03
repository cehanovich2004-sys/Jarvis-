import assert from "node:assert/strict";
import { test } from "node:test";
import { JarvisCore } from "../../src/core.js";
import { JarvisError } from "../../src/errors.js";
import { InMemoryCommandRepository } from "../../src/repository.js";
import { assertLoopbackHost, parsePort } from "../../src/config.js";

test("status command returns a completed command", async () => {
  const core = new JarvisCore(new InMemoryCommandRepository());

  const command = await core.ask({ id: "status-1", text: "статус" });

  assert.equal(command.id, "status-1");
  assert.equal(command.kind, "status");
  assert.equal(command.normalizedText, "статус");
  assert.equal(command.state, "completed");
  assert.match(command.response, /JARVIS Core работает локально/);
});

test("help command returns supported commands", async () => {
  const core = new JarvisCore(new InMemoryCommandRepository());

  const command = await core.ask({ text: "помощь" });

  assert.equal(command.kind, "help");
  assert.match(command.response, /статус, помощь/);
});

test("unknown command is rejected", async () => {
  const core = new JarvisCore(new InMemoryCommandRepository());

  await assert.rejects(() => core.ask({ text: "запусти приложение" }), (error) => {
    assert.ok(error instanceof JarvisError);
    assert.equal(error.code, "COMMAND_NOT_SUPPORTED");
    assert.equal(error.statusCode, 422);
    return true;
  });
});

test("duplicate command id is rejected", async () => {
  const core = new JarvisCore(new InMemoryCommandRepository());

  await core.ask({ id: "duplicate", text: "статус" });

  await assert.rejects(() => core.ask({ id: "duplicate", text: "помощь" }), (error) => {
    assert.ok(error instanceof JarvisError);
    assert.equal(error.code, "COMMAND_ID_CONFLICT");
    assert.equal(error.statusCode, 409);
    return true;
  });
});

test("bind host validation accepts only loopback hosts", () => {
  assert.doesNotThrow(() => assertLoopbackHost("127.0.0.1"));
  assert.doesNotThrow(() => assertLoopbackHost("localhost"));
  assert.doesNotThrow(() => assertLoopbackHost("::1"));
  assert.throws(() => assertLoopbackHost("192.168.1.20"), /loopback/);
});

test("port parsing validates range", () => {
  assert.equal(parsePort(undefined), 3147);
  assert.equal(parsePort("0"), 0);
  assert.equal(parsePort("8080"), 8080);
  assert.throws(() => parsePort("65536"), /between 0 and 65535/);
  assert.throws(() => parsePort("abc"), /between 0 and 65535/);
});

