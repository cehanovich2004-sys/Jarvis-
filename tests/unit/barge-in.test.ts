import assert from "node:assert/strict";
import test from "node:test";
import { JarvisError } from "../../src/errors.js";
import {
  ExclusiveActionExecutor,
  VoiceInteractionCoordinator,
  VoiceInteractionService,
  VoiceInteractionStateMachine,
  type ActionExecutorPort
} from "../../src/interaction/index.js";
import type { ToolExecutionResult } from "../../src/tools/contracts.js";

const RESULT: ToolExecutionResult = {
  status: "SUCCESS",
  intent: "GET_BATTERY",
  verified: true,
  data: { percentage: 25, powerSource: "AC" }
};

test("state machine supports explicit interruption from active stages only", () => {
  const responding = new VoiceInteractionStateMachine();
  responding.transition("VERIFYING_SPEAKER");
  responding.transition("TRANSCRIBING");
  responding.transition("UNDERSTANDING");
  responding.transition("EXECUTING");
  responding.transition("RESPONDING");
  responding.finish("INTERRUPTED");
  assert.equal(responding.state, "INTERRUPTED");
  assert.throws(() => responding.transition("CANCELLED"), /Invalid voice interaction transition/u);
});

test("exclusive executor never overlaps delegate calls", async () => {
  const first = deferred<ToolExecutionResult>();
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  const delegate: ActionExecutorPort = {
    async execute() {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (calls === 1) await first.promise;
      active -= 1;
      return RESULT;
    }
  };
  const executor = new ExclusiveActionExecutor(delegate);
  const one = executor.execute(command());
  const two = executor.execute(command());
  await tick();
  assert.equal(calls, 1);
  first.resolve(RESULT);
  await Promise.all([one, two]);
  assert.equal(calls, 2);
  assert.equal(maximumActive, 1);
});

test("exclusive executor skips queued work cancelled before delegate invocation", async () => {
  const first = deferred<ToolExecutionResult>();
  let calls = 0;
  const delegate: ActionExecutorPort = {
    async execute() {
      calls += 1;
      if (calls === 1) return first.promise;
      return RESULT;
    }
  };
  const executor = new ExclusiveActionExecutor(delegate);
  const one = executor.execute(command());
  const controller = new AbortController();
  const two = executor.execute(command(), controller.signal);
  controller.abort(new Error("cancel queued work"));
  first.resolve(RESULT);
  await one;
  await assert.rejects(two, /cancel queued work/u);
  assert.equal(calls, 1);
});

test("coordinator rejects unsafe interaction IDs before taking ownership", () => {
  const coordinator = new VoiceInteractionCoordinator({} as VoiceInteractionService);
  assert.throws(
    () => coordinator.start({ interactionId: "../../secret", audio: {} as never, ownerProfileId: "owner" }),
    (error: unknown) => error instanceof JarvisError && error.code === "INTERACTION_INVALID_ID"
  );
  assert.equal(coordinator.activeInteractionId, null);
});

function command(): Parameters<ActionExecutorPort["execute"]>[0] {
  return { intent: "GET_BATTERY", parameters: {}, confidence: 1 };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
