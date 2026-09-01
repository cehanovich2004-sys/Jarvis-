import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AudioData } from "../../src/audio/contracts.js";
import { JarvisError } from "../../src/errors.js";
import {
  InMemoryOwnerSpeakerProfileRepository,
  JsonOwnerSpeakerProfileRepository,
  PythonVoiceIDRuntimeClient,
  SpeakerRecognitionService,
  ThresholdDecisionPolicy,
  VoiceIDAdapter,
  loadDevelopmentDecisionPolicy,
  VOICEID_BACKEND_NAME,
  VOICEID_BACKEND_VERSION,
  VOICEID_COMPARISON_VERSION,
  VOICEID_EMBEDDING_CONTRACT_VERSION,
  VOICEID_EMBEDDING_DIMENSION,
  VOICEID_MODEL_IDENTIFIER,
  VOICEID_MODEL_REVISION,
  VOICEID_PREPROCESSING_CONTRACT_VERSION,
  VOICEID_SAMPLE_RATE_HZ,
  type OwnerSpeakerProfile,
  type OwnerSpeakerProfileRepository,
  type SpeakerDecisionPolicy,
  type SpeakerEmbedding,
  type SpeakerEmbeddingMetadata,
  type VoiceIDAudioInput,
  type VoiceIDEmbeddingResult,
  type VoiceIDRuntimeClient,
  type VoiceIDSimilarityResult
} from "../../src/voiceid/index.js";

const CREATED_AT = "2026-08-29T00:00:00.000Z";

function audio(overrides: Partial<AudioData> = {}): AudioData {
  const samples = overrides.samples ?? new Float32Array([0.25, -0.25]);
  return {
    sampleRate: VOICEID_SAMPLE_RATE_HZ,
    channels: 1,
    format: "pcm-f32",
    samples,
    durationSeconds: samples.length / VOICEID_SAMPLE_RATE_HZ,
    ...overrides
  };
}

function metadata(overrides: Partial<SpeakerEmbeddingMetadata> = {}): SpeakerEmbeddingMetadata {
  return {
    embeddingDimension: VOICEID_EMBEDDING_DIMENSION,
    modelIdentifier: VOICEID_MODEL_IDENTIFIER,
    modelRevision: VOICEID_MODEL_REVISION,
    backendName: VOICEID_BACKEND_NAME,
    backendVersion: VOICEID_BACKEND_VERSION,
    preprocessingContractVersion: VOICEID_PREPROCESSING_CONTRACT_VERSION,
    embeddingContractVersion: VOICEID_EMBEDDING_CONTRACT_VERSION,
    inputSampleRateHz: VOICEID_SAMPLE_RATE_HZ,
    normalized: false,
    ...overrides
  };
}

function vector(value = 1, dimension = VOICEID_EMBEDDING_DIMENSION): Float32Array {
  const result = new Float32Array(dimension);
  result[0] = value;
  return result;
}

function validEmbedding(value = 1): VoiceIDEmbeddingResult {
  return { status: "VALID", embedding: vector(value), metadata: metadata() };
}

function embedding(value = 1, overrides: Partial<SpeakerEmbeddingMetadata> = {}): SpeakerEmbedding {
  return { values: vector(value), metadata: metadata(overrides), embeddingLatencyMs: 0 };
}

function similarity(value: number): VoiceIDSimilarityResult {
  return {
    status: "VALID",
    similarity: value,
    metric: "cosine_similarity",
    comparisonVersion: VOICEID_COMPARISON_VERSION,
    embeddingDimension: VOICEID_EMBEDDING_DIMENSION,
    normalized: false
  };
}

class FakeRuntime implements VoiceIDRuntimeClient {
  readonly embeddingResults: Array<VoiceIDEmbeddingResult | Error>;
  readonly similarityResults: Array<VoiceIDSimilarityResult | Error>;
  readonly audioInputs: VoiceIDAudioInput[] = [];
  compareCalls = 0;

  constructor(
    embeddingResults: Array<VoiceIDEmbeddingResult | Error>,
    similarityResults: Array<VoiceIDSimilarityResult | Error> = []
  ) {
    this.embeddingResults = [...embeddingResults];
    this.similarityResults = [...similarityResults];
  }

  async extractEmbedding(input: VoiceIDAudioInput): Promise<VoiceIDEmbeddingResult> {
    this.audioInputs.push({ ...input, waveform: input.waveform.slice() });
    const result = this.embeddingResults.shift();
    if (result instanceof Error) {
      throw result;
    }
    if (result === undefined) {
      throw new Error("missing fake embedding result");
    }
    return result;
  }

  async compareEmbeddings(): Promise<VoiceIDSimilarityResult> {
    this.compareCalls += 1;
    const result = this.similarityResults.shift();
    if (result instanceof Error) {
      throw result;
    }
    if (result === undefined) {
      throw new Error("missing fake similarity result");
    }
    return result;
  }
}

function policy(): ThresholdDecisionPolicy {
  return new ThresholdDecisionPolicy({
    authorizedThreshold: 0.8,
    unauthorizedThreshold: 0.3,
    policyId: "test-only-calibration-required"
  });
}

function service(
  runtime: FakeRuntime,
  profiles: OwnerSpeakerProfileRepository = new InMemoryOwnerSpeakerProfileRepository()
) {
  return new SpeakerRecognitionService({
    adapter: new VoiceIDAdapter(runtime),
    profiles,
    decisionPolicy: policy(),
    now: () => new Date(CREATED_AT)
  });
}

async function assertRejectsCode(promise: Promise<unknown>, code: JarvisError["code"]): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof JarvisError && error.code === code
  );
}

test("threshold policy returns authorized, unauthorized, and uncertain without defaults", () => {
  const decisionPolicy = policy();

  assert.equal(decisionPolicy.decide([0.81]).status, "AUTHORIZED");
  assert.equal(decisionPolicy.decide([0.3]).status, "UNAUTHORIZED");
  assert.equal(decisionPolicy.decide([0.5]).status, "UNCERTAIN");
  assert.equal(decisionPolicy.calibrationRequired, true);
});

test("threshold policy rejects invalid or overlapping thresholds", () => {
  assert.throws(
    () =>
      new ThresholdDecisionPolicy({
        authorizedThreshold: 0.5,
        unauthorizedThreshold: 0.5,
        policyId: "invalid-policy"
      }),
    JarvisError
  );
});

test("enrollment requires multiple samples and stores no raw audio", async () => {
  const runtime = new FakeRuntime([validEmbedding(1), validEmbedding(0.9)]);
  const profiles = new InMemoryOwnerSpeakerProfileRepository();
  const recognition = service(runtime, profiles);

  await assertRejectsCode(recognition.enrollOwner("owner-main", [audio()]), "SPEAKER_PROFILE_INCOMPATIBLE");
  const profile = await recognition.enrollOwner("owner-main", [audio(), audio()]);

  assert.equal(profile.referenceCount, 2);
  assert.equal(profile.createdAt, CREATED_AT);
  assert.equal("audio" in profile, false);
  assert.equal("samples" in profile, false);
  assert.equal("referenceEmbeddings" in profile, false);
  assert.equal((await profiles.get("owner-main"))?.referenceEmbeddings.length, 2);
});

test("enrollment rejects an unbounded reference set before inference", async () => {
  const runtime = new FakeRuntime([]);
  const samples = Array.from({ length: 17 }, () => audio());

  await assertRejectsCode(
    service(runtime).enrollOwner("owner-main", samples),
    "SPEAKER_PROFILE_INCOMPATIBLE"
  );
  assert.equal(runtime.audioInputs.length, 0);
});

test("verification returns authorized result and privacy-safe metadata", async () => {
  const runtime = new FakeRuntime(
    [validEmbedding(1), validEmbedding(0.9), validEmbedding(0.8)],
    [similarity(0.91), similarity(0.72)]
  );
  const recognition = service(runtime);
  await recognition.enrollOwner("owner-main", [audio(), audio()]);

  const result = await recognition.verifySpeaker(audio(), "owner-main");

  assert.equal(result.status, "AUTHORIZED");
  assert.equal(result.similarity, 0.91);
  assert.equal(result.authorizedThreshold, 0.8);
  assert.equal(result.unauthorizedThreshold, 0.3);
  assert.equal(result.metadata.referencesCompared, 2);
  assert.equal(result.metadata.calibrationRequired, true);
  assert.equal("embedding" in result, false);
  assert.equal(runtime.compareCalls, 2);
});

test("verification returns unauthorized and uncertain decisions", async () => {
  for (const [score, expected] of [
    [0.2, "UNAUTHORIZED"],
    [0.5, "UNCERTAIN"]
  ] as const) {
    const runtime = new FakeRuntime(
      [validEmbedding(1), validEmbedding(0.9), validEmbedding(0.8)],
      [similarity(score), similarity(score - 0.01)]
    );
    const recognition = service(runtime);
    await recognition.enrollOwner("owner-main", [audio(), audio()]);

    assert.equal((await recognition.verifySpeaker(audio(), "owner-main")).status, expected);
  }
});

test("verification rejects a missing owner profile", async () => {
  await assertRejectsCode(
    service(new FakeRuntime([])).verifySpeaker(audio(), "missing-owner"),
    "SPEAKER_PROFILE_NOT_FOUND"
  );
});

test("adapter rejects malformed audio before calling runtime", async () => {
  const runtime = new FakeRuntime([]);
  const adapter = new VoiceIDAdapter(runtime);

  await assertRejectsCode(
    adapter.extractEmbedding(audio({ sampleRate: 44_100 })),
    "SPEAKER_INVALID_AUDIO"
  );
  await assertRejectsCode(
    adapter.extractEmbedding(audio({ durationSeconds: 99 })),
    "SPEAKER_INVALID_AUDIO"
  );
  assert.equal(runtime.audioInputs.length, 0);
});

test("adapter copies audio across the runtime boundary", async () => {
  const runtime = new FakeRuntime([validEmbedding()]);
  const adapter = new VoiceIDAdapter(runtime);
  const input = audio();

  const pending = adapter.extractEmbedding(input);
  input.samples[0] = 0.75;
  await pending;

  assert.equal(runtime.audioInputs[0]?.waveform[0], 0.25);
});

test("adapter rejects wrong dimension, non-finite, and near-zero embeddings", async () => {
  const invalidResults: VoiceIDEmbeddingResult[] = [
    { status: "VALID", embedding: vector(1, 191), metadata: metadata() },
    { status: "VALID", embedding: vector(Number.NaN), metadata: metadata() },
    { status: "VALID", embedding: vector(0), metadata: metadata() }
  ];

  for (const result of invalidResults) {
    await assertRejectsCode(
      new VoiceIDAdapter(new FakeRuntime([result])).extractEmbedding(audio()),
      "SPEAKER_INVALID_EMBEDDING"
    );
  }
});

test("adapter maps model, audio, embedding, and backend failures", async () => {
  const cases = [
    ["MODEL_CACHE_MISSING", "SPEAKER_MODEL_UNAVAILABLE"],
    ["ZERO_OR_NEAR_ZERO_WAVEFORM", "SPEAKER_INVALID_AUDIO"],
    ["INVALID_EMBEDDING_SHAPE", "SPEAKER_INVALID_EMBEDDING"],
    ["INFERENCE_FAILED", "SPEAKER_EMBEDDING_FAILURE"]
  ] as const;

  for (const [errorCode, expected] of cases) {
    await assertRejectsCode(
      new VoiceIDAdapter(new FakeRuntime([{ status: "INVALID", errorCode }])).extractEmbedding(
        audio()
      ),
      expected
    );
  }
  await assertRejectsCode(
    new VoiceIDAdapter(new FakeRuntime([new Error("private model path")])).extractEmbedding(audio()),
    "SPEAKER_EMBEDDING_FAILURE"
  );
});

test("adapter fails closed on malformed runtime results", async () => {
  const malformedRuntime: VoiceIDRuntimeClient = {
    async extractEmbedding(): Promise<VoiceIDEmbeddingResult> {
      return null as unknown as VoiceIDEmbeddingResult;
    },
    async compareEmbeddings(): Promise<VoiceIDSimilarityResult> {
      return { status: "VALID" } as unknown as VoiceIDSimilarityResult;
    }
  };
  const adapter = new VoiceIDAdapter(malformedRuntime);

  await assertRejectsCode(adapter.extractEmbedding(audio()), "SPEAKER_EMBEDDING_FAILURE");
  await assertRejectsCode(
    adapter.compare(embedding(1), embedding(0.9)),
    "SPEAKER_VERIFICATION_FAILURE"
  );
});

test("adapter bounds a non-cooperative VoiceID runtime", async () => {
  const runtime: VoiceIDRuntimeClient = {
    async extractEmbedding(): Promise<VoiceIDEmbeddingResult> {
      return await new Promise<VoiceIDEmbeddingResult>(() => undefined);
    },
    async compareEmbeddings(): Promise<VoiceIDSimilarityResult> {
      return await new Promise<VoiceIDSimilarityResult>(() => undefined);
    }
  };

  await assertRejectsCode(
    new VoiceIDAdapter(runtime, 5).extractEmbedding(audio()),
    "SPEAKER_EMBEDDING_FAILURE"
  );
});

test("adapter rejects incompatible profile provenance", async () => {
  const adapter = new VoiceIDAdapter(new FakeRuntime([]));
  await assertRejectsCode(
    adapter.compare(embedding(1), embedding(1, { modelRevision: "different" })),
    "SPEAKER_PROFILE_INCOMPATIBLE"
  );
});

test("adapter maps VoiceID comparison failures", async () => {
  const adapter = new VoiceIDAdapter(
    new FakeRuntime([], [{ status: "INVALID", errorCode: "COMPARISON_ERROR" }])
  );
  await assertRejectsCode(
    adapter.compare(embedding(1), embedding(0.9)),
    "SPEAKER_VERIFICATION_FAILURE"
  );
});

test("service rejects incompatible stored profile metadata", async () => {
  const forged: OwnerSpeakerProfile = {
    profileId: "owner-main",
    referenceEmbeddings: [embedding(1), embedding(0.9, { backendVersion: "wrong" })],
    createdAt: CREATED_AT
  };
  const profiles: OwnerSpeakerProfileRepository = {
    async get(): Promise<OwnerSpeakerProfile> {
      return forged;
    },
    async put(): Promise<void> {}
  };

  await assertRejectsCode(
    service(new FakeRuntime([]), profiles).verifySpeaker(audio(), "owner-main"),
    "SPEAKER_PROFILE_INCOMPATIBLE"
  );
});

test("service sanitizes profile repository failures", async () => {
  const profiles: OwnerSpeakerProfileRepository = {
    async get(): Promise<OwnerSpeakerProfile> {
      throw new Error("private database path");
    },
    async put(): Promise<void> {
      throw new Error("private database path");
    }
  };
  const recognition = service(new FakeRuntime([validEmbedding(), validEmbedding()]), profiles);

  await assertRejectsCode(
    recognition.enrollOwner("owner-main", [audio(), audio()]),
    "SPEAKER_VERIFICATION_FAILURE"
  );
  await assertRejectsCode(
    recognition.verifySpeaker(audio(), "owner-main"),
    "SPEAKER_VERIFICATION_FAILURE"
  );
});

test("service sanitizes unexpected decision policy failures", async () => {
  const runtime = new FakeRuntime(
    [validEmbedding(), validEmbedding(), validEmbedding()],
    [similarity(0.9), similarity(0.9)]
  );
  const profiles = new InMemoryOwnerSpeakerProfileRepository();
  const brokenPolicy: SpeakerDecisionPolicy = {
    policyId: "broken-policy",
    calibrationRequired: true,
    decide(): never {
      throw new Error("sensitive policy detail");
    }
  };
  const recognition = new SpeakerRecognitionService({
    adapter: new VoiceIDAdapter(runtime),
    profiles,
    decisionPolicy: brokenPolicy,
    now: () => new Date(CREATED_AT)
  });
  await recognition.enrollOwner("owner-main", [audio(), audio()]);

  await assertRejectsCode(
    recognition.verifySpeaker(audio(), "owner-main"),
    "SPEAKER_VERIFICATION_FAILURE"
  );
});

test("service rejects a contradictory decision policy result", async () => {
  const runtime = new FakeRuntime(
    [validEmbedding(), validEmbedding(), validEmbedding()],
    [similarity(0.9), similarity(0.9)]
  );
  const profiles = new InMemoryOwnerSpeakerProfileRepository();
  const contradictoryPolicy: SpeakerDecisionPolicy = {
    policyId: "contradictory-policy",
    calibrationRequired: true,
    decide() {
      return {
        status: "UNAUTHORIZED",
        similarity: 0.9,
        authorizedThreshold: 0.8,
        unauthorizedThreshold: 0.3
      };
    }
  };
  const recognition = new SpeakerRecognitionService({
    adapter: new VoiceIDAdapter(runtime),
    profiles,
    decisionPolicy: contradictoryPolicy,
    now: () => new Date(CREATED_AT)
  });
  await recognition.enrollOwner("owner-main", [audio(), audio()]);

  await assertRejectsCode(
    recognition.verifySpeaker(audio(), "owner-main"),
    "SPEAKER_VERIFICATION_FAILURE"
  );
});

test("development policy is explicit, configurable, and never presented as calibrated", () => {
  assert.throws(() => loadDevelopmentDecisionPolicy({}), hasCode("SPEAKER_VERIFICATION_FAILURE"));
  const policy = loadDevelopmentDecisionPolicy({
    JARVIS_VOICEID_POLICY_MODE: "DEVELOPMENT_ONLY",
    JARVIS_VOICEID_DEV_AUTHORIZED_THRESHOLD: "0.8",
    JARVIS_VOICEID_DEV_UNAUTHORIZED_THRESHOLD: "0.5"
  });
  assert.equal(policy.policyId, "development-only-explicit-v1");
  assert.equal(policy.calibrationRequired, true);
  assert.equal(policy.decide([0.9]).status, "AUTHORIZED");
  assert.equal(policy.decide([0.6]).status, "UNCERTAIN");
  assert.equal(policy.decide([0.2]).status, "UNAUTHORIZED");
});

test("JSON owner profile store is private, atomic, defensive, and deletable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-profile-"));
  await chmod(directory, 0o700);
  const path = join(directory, "owner.json");
  const repository = new JsonOwnerSpeakerProfileRepository(path);
  const profile: OwnerSpeakerProfile = {
    profileId: "owner-main",
    createdAt: CREATED_AT,
    referenceEmbeddings: [embedding(1), embedding(2)]
  };
  try {
    await repository.put(profile);
    assert.equal((await stat(path)).mode & 0o077, 0);
    const restored = await repository.get("owner-main");
    assert.deepEqual(restored?.referenceEmbeddings.map((item) => [...item.values]), [[1, ...new Array(191).fill(0)], [2, ...new Array(191).fill(0)]]);
    restored?.referenceEmbeddings[0]?.values.fill(9);
    assert.equal((await repository.get("owner-main"))?.referenceEmbeddings[0]?.values[0], 1);
    assert.equal(await repository.delete("owner-main"), true);
    assert.equal(await repository.get("owner-main"), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON owner profile store rejects public permissions and unknown fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-profile-"));
  await chmod(directory, 0o700);
  const path = join(directory, "owner.json");
  const repository = new JsonOwnerSpeakerProfileRepository(path);
  try {
    await repository.put({
      profileId: "owner-main",
      createdAt: CREATED_AT,
      referenceEmbeddings: [embedding(1), embedding(2)]
    });
    await chmod(path, 0o644);
    await assertRejectsCode(repository.get("owner-main"), "SPEAKER_PROFILE_INCOMPATIBLE");
    await chmod(path, 0o600);
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    parsed.secret = "not accepted";
    await writeFile(path, JSON.stringify(parsed), { mode: 0o600 });
    await assertRejectsCode(repository.get("owner-main"), "SPEAKER_PROFILE_INCOMPATIBLE");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Python VoiceID runtime terminates its process on cancellation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-voiceid-runtime-"));
  const script = join(directory, "bridge.py");
  await writeFile(script, "import sys,time\nfor line in sys.stdin:\n time.sleep(30)\n", { mode: 0o700 });
  const runtime = new PythonVoiceIDRuntimeClient({
    pythonExecutable: "/usr/bin/python3",
    bridgeScript: script,
    voiceIdSourceDirectory: directory,
    modelCacheDirectory: directory
  });
  const controller = new AbortController();
  try {
    const pending = runtime.extractEmbedding({
      waveform: new Float32Array([0.1]),
      sampleRateHz: 16_000,
      channels: 1,
      format: "pcm-f32"
    }, controller.signal);
    controller.abort(new Error("cancelled"));
    await assert.rejects(pending);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Python VoiceID runtime imports multiple enrollment references through its typed bridge", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-voiceid-import-"));
  const script = join(directory, "bridge.py");
  const bridge = [
    "import json,sys",
    "for line in sys.stdin:",
    " request=json.loads(line)",
    " embedding={'status':'VALID','embedding':[1.0]+[0.0]*191,'metadata':{}}",
    " result={'status':'VALID','participantCode':request['payload']['participantCode'],'embeddings':[embedding,embedding]}",
    " print(json.dumps({'id':request['id'],'result':result}),flush=True)"
  ].join("\n");
  await writeFile(script, bridge, { mode: 0o700 });
  const runtime = new PythonVoiceIDRuntimeClient({
    pythonExecutable: "/usr/bin/python3",
    bridgeScript: script,
    voiceIdSourceDirectory: directory,
    modelCacheDirectory: directory,
    voiceIdDataDirectory: directory
  });
  try {
    const references = await runtime.importEnrollmentProfile("P0001");
    assert.equal(references.length, 2);
    assert.equal(references.every((item) => item.status === "VALID"), true);
    await assert.rejects(runtime.importEnrollmentProfile("owner-main"), hasCode("SPEAKER_MODEL_UNAVAILABLE"));
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Python VoiceID runtime supports an explicit bounded warmup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-voiceid-warmup-"));
  const script = join(directory, "bridge.py");
  await writeFile(
    script,
    "import json,sys\nfor line in sys.stdin:\n request=json.loads(line)\n print(json.dumps({'id':request['id'],'result':{'status':'READY'}}),flush=True)\n",
    { mode: 0o700 }
  );
  const runtime = new PythonVoiceIDRuntimeClient({
    pythonExecutable: "/usr/bin/python3",
    bridgeScript: script,
    voiceIdSourceDirectory: directory,
    modelCacheDirectory: directory
  });
  try {
    await runtime.warmup();
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Python VoiceID runtime rejects an unsafe optional enrollment data path", () => {
  assert.throws(
    () => new PythonVoiceIDRuntimeClient({
      pythonExecutable: "/usr/bin/python3",
      bridgeScript: "/tmp/bridge.py",
      voiceIdSourceDirectory: "/tmp/voiceid-src",
      modelCacheDirectory: "/tmp/model-cache",
      voiceIdDataDirectory: "relative/voiceid-data"
    }),
    hasCode("SPEAKER_MODEL_UNAVAILABLE")
  );
});

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof JarvisError && error.code === code;
}
