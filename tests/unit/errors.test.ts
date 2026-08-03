import assert from "node:assert/strict";
import { test } from "node:test";
import { JarvisError, toJarvisError } from "../../src/errors.js";

test("unknown exceptions become safe internal errors", () => {
  const error = toJarvisError(new Error("database exploded with sensitive detail"));
  const response = error.toResponse();

  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.statusCode, 500);
  assert.equal(response.error.code, "INTERNAL_ERROR");
  assert.equal(response.error.message, "Unexpected Jarvis Core error.");
  assert.equal("details" in response.error, false);
  assert.equal(response.error.message.includes("database exploded"), false);
});

test("existing JarvisError instances are preserved", () => {
  const original = new JarvisError("INVALID_PAYLOAD", 400, "Payload is invalid.", {
    field: "text"
  });

  const error = toJarvisError(original);

  assert.equal(error, original);
  assert.equal(error.code, "INVALID_PAYLOAD");
  assert.equal(error.statusCode, 400);
  assert.deepEqual(error.details, { field: "text" });
});

