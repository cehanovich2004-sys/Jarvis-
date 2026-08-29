import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicIntentRouter, PermissionEngine } from "../../src/intents/index.js";
import type { TranscriptResult } from "../../src/stt/contracts.js";
import {
  GetBatteryTool,
  SafeActionExecutor,
  ToolRegistry,
  type SafeMacOSOperation,
  type SafeMacOSOperationRunner
} from "../../src/tools/index.js";

test("validated transcript routes to a permissioned tool and verified execution result", async () => {
  const transcript: TranscriptResult = {
    status: "SUCCESS",
    text: "Джарвис, какой заряд батареи?",
    language: "ru",
    durationSeconds: 1,
    transcriptionLatencyMs: 20,
    backendMetadata: { backend: "fake", model: "fake" }
  };
  const routed = new DeterministicIntentRouter().route(transcript);
  assert.equal(routed.status, "MATCHED");
  assert.ok(routed.command !== null);

  const operations: SafeMacOSOperation[] = [];
  const runner: SafeMacOSOperationRunner = {
    async run(operation) {
      operations.push(operation);
      return {
        exitCode: 0,
        stdout: "Now drawing from 'Battery Power'\n -InternalBattery-0\t73%; discharging"
      };
    }
  };
  const registry = new ToolRegistry();
  registry.register(new GetBatteryTool(runner));
  const result = await new SafeActionExecutor(new PermissionEngine(), registry).execute(
    routed.command
  );

  assert.deepEqual(operations, [{ kind: "GET_BATTERY" }]);
  assert.deepEqual(result, {
    status: "SUCCESS",
    intent: "GET_BATTERY",
    verified: true,
    data: { percentage: 73, powerSource: "BATTERY" }
  });
});
