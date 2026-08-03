import assert from "node:assert/strict";
import { test } from "node:test";
import { JarvisError } from "../../src/errors.js";
import { parseCreateCommandRequest, parseSupportedCommandText } from "../../src/validation.js";

test("create command payload requires an object", () => {
  assert.throws(() => parseCreateCommandRequest(null), JarvisError);
  assert.throws(() => parseCreateCommandRequest([]), JarvisError);
});

test("create command payload requires text", () => {
  assert.throws(() => parseCreateCommandRequest({ text: "" }), JarvisError);
  assert.throws(() => parseCreateCommandRequest({}), JarvisError);
});

test("create command payload accepts optional safe id", () => {
  assert.deepEqual(parseCreateCommandRequest({ id: "cmd_1", text: "статус" }), {
    id: "cmd_1",
    text: "статус"
  });
});

test("create command payload rejects unsafe id", () => {
  assert.throws(() => parseCreateCommandRequest({ id: "../x", text: "статус" }), (error) => {
    assert.ok(error instanceof JarvisError);
    assert.equal(error.code, "INVALID_PAYLOAD");
    return true;
  });
});

test("supported command text is normalized", () => {
  assert.equal(parseSupportedCommandText("  СТАТУС  "), "статус");
  assert.equal(parseSupportedCommandText(" помощь "), "помощь");
});

