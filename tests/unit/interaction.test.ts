import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicResponseGenerator } from "../../src/interaction/responses.js";
import { VoiceInteractionStateMachine } from "../../src/interaction/state-machine.js";
import type { ToolExecutionResult } from "../../src/tools/contracts.js";

test("voice interaction state machine accepts the successful explicit transition path", () => {
  const machine = new VoiceInteractionStateMachine();
  for (const state of [
    "VERIFYING_SPEAKER",
    "TRANSCRIBING",
    "UNDERSTANDING",
    "EXECUTING",
    "RESPONDING",
    "COMPLETE"
  ] as const) {
    machine.transition(state);
  }
  assert.deepEqual(machine.transitions, [
    "START",
    "VERIFYING_SPEAKER",
    "TRANSCRIBING",
    "UNDERSTANDING",
    "EXECUTING",
    "RESPONDING",
    "COMPLETE"
  ]);
  assert.throws(() => machine.transition("ERROR"), /Invalid voice interaction transition/u);
});

test("voice interaction state machine rejects skipped and post-terminal transitions", () => {
  const machine = new VoiceInteractionStateMachine();
  assert.throws(() => machine.transition("EXECUTING"), /Invalid voice interaction transition/u);
  machine.transition("VERIFYING_SPEAKER");
  machine.transition("RESPONDING");
  machine.finish("UNAUTHORIZED");
  assert.throws(() => machine.transition("TRANSCRIBING"), /Invalid voice interaction transition/u);
});

test("deterministic responses cover every supported execution result", () => {
  const responses = new DeterministicResponseGenerator();
  const results: readonly [ToolExecutionResult, string][] = [
    [
      {
        status: "SUCCESS",
        intent: "GET_BATTERY",
        verified: true,
        data: { percentage: 25, powerSource: "AC" }
      },
      "Заряд батареи 25 процентов. Питание от сети."
    ],
    [
      {
        status: "SUCCESS",
        intent: "GET_BATTERY",
        verified: true,
        data: { percentage: 73, powerSource: "BATTERY" }
      },
      "Заряд батареи 73 процентов. Питание от батареи."
    ],
    [
      {
        status: "SUCCESS",
        intent: "OPEN_APPLICATION",
        verified: true,
        data: { application: "Safari", running: true }
      },
      "Safari открыт."
    ],
    [
      { status: "FAILED", intent: "GET_BATTERY", verified: false, data: null },
      "Не удалось выполнить команду."
    ]
  ];
  for (const [result, expected] of results) {
    assert.equal(responses.forExecution(result), expected);
  }
});
