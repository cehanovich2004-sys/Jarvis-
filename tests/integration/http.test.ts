import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandResponse, ErrorResponse, HealthResponse } from "../../src/contracts.js";
import { startJarvisServer } from "../../src/http.js";

async function jsonBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

test("http API serves health and command lifecycle on loopback", async () => {
  const started = await startJarvisServer({ port: 0 });

  try {
    assert.equal(started.host, "127.0.0.1");
    const baseUrl = `http://${started.host}:${started.port}`;

    const healthResponse = await fetch(`${baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
    const health = await jsonBody<HealthResponse>(healthResponse);
    assert.equal(health.status, "ok");
    assert.equal(health.bindHost, "127.0.0.1");
    assert.equal(health.storage, "memory");

    const createResponse = await fetch(`${baseUrl}/v1/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "integration-status", text: "статус" })
    });
    assert.equal(createResponse.status, 201);
    const created = await jsonBody<CommandResponse>(createResponse);
    assert.equal(created.command.id, "integration-status");
    assert.equal(created.command.kind, "status");

    const getResponse = await fetch(`${baseUrl}/v1/commands/integration-status`);
    assert.equal(getResponse.status, 200);
    const found = await jsonBody<CommandResponse>(getResponse);
    assert.equal(found.command.id, "integration-status");
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test("http API rejects invalid payload", async () => {
  const started = await startJarvisServer({ port: 0 });

  try {
    const response = await fetch(`http://${started.host}:${started.port}/v1/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "" })
    });

    assert.equal(response.status, 400);
    const body = await jsonBody<ErrorResponse>(response);
    assert.equal(body.error.code, "INVALID_PAYLOAD");
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test("http API rejects unknown command", async () => {
  const started = await startJarvisServer({ port: 0 });

  try {
    const response = await fetch(`http://${started.host}:${started.port}/v1/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "открой почту" })
    });

    assert.equal(response.status, 422);
    const body = await jsonBody<ErrorResponse>(response);
    assert.equal(body.error.code, "COMMAND_NOT_SUPPORTED");
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

test("http API rejects duplicate command id", async () => {
  const started = await startJarvisServer({ port: 0 });

  try {
    const baseUrl = `http://${started.host}:${started.port}`;
    const payload = { id: "duplicate-http", text: "статус" };

    const first = await fetch(`${baseUrl}/v1/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal(first.status, 201);

    const second = await fetch(`${baseUrl}/v1/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal(second.status, 409);
    const body = await jsonBody<ErrorResponse>(second);
    assert.equal(body.error.code, "COMMAND_ID_CONFLICT");
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});
