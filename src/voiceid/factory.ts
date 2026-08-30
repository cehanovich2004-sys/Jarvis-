import { homedir } from "node:os";
import { resolve } from "node:path";
import { JarvisError } from "../errors.js";
import { validateEmbedding, VoiceIDAdapter } from "./adapter.js";
import { JsonOwnerSpeakerProfileRepository } from "./file-profile.js";
import { buildOwnerSpeakerProfile } from "./profile.js";
import { ThresholdDecisionPolicy } from "./policy.js";
import { PythonVoiceIDRuntimeClient } from "./python-runtime.js";
import { SpeakerRecognitionService } from "./service.js";

export interface RealVoiceIDComponents {
  readonly service: SpeakerRecognitionService;
  readonly profiles: JsonOwnerSpeakerProfileRepository;
  readonly runtime: PythonVoiceIDRuntimeClient;
  close(): Promise<void>;
}

export function createRealVoiceIDComponents(
  environment: NodeJS.ProcessEnv = process.env,
  options: { readonly enrollmentOnly?: boolean } = {}
): RealVoiceIDComponents {
  const home = environment.HOME ?? homedir();
  const projectRoot = environment.JARVIS_VOICEID_PROJECT_ROOT ?? resolve(process.cwd(), "../VoiceID");
  const pythonExecutable = environment.JARVIS_VOICEID_PYTHON ?? resolve(projectRoot, ".venv/bin/python");
  const modelCacheDirectory = environment.JARVIS_VOICEID_CACHE_DIR ?? resolve(home, ".cache/voiceid/speechbrain_ecapa");
  const profilePath = environment.JARVIS_OWNER_PROFILE_PATH ?? resolve(home, ".jarvis/voice/owner-profile.json");
  const bridgeScript = resolve(process.cwd(), "scripts/voiceid_bridge.py");
  const voiceIdDataDirectory = environment.JARVIS_VOICEID_DATA_DIR ??
    resolve(home, ".local/share/voiceid/telegram_bot");
  const runtime = new PythonVoiceIDRuntimeClient({
    pythonExecutable,
    bridgeScript,
    voiceIdSourceDirectory: resolve(projectRoot, "src"),
    modelCacheDirectory,
    voiceIdDataDirectory
  });
  const profiles = new JsonOwnerSpeakerProfileRepository(profilePath);
  const decisionPolicy = options.enrollmentOnly === true
    ? new EnrollmentOnlyDecisionPolicy()
    : loadDevelopmentDecisionPolicy(environment);
  const service = new SpeakerRecognitionService({
    adapter: new VoiceIDAdapter(runtime, readPositiveInteger(environment.JARVIS_VOICEID_TIMEOUT_MS, 60_000)),
    profiles,
    decisionPolicy
  });
  return { service, profiles, runtime, close: () => runtime.close() };
}

export async function importVoiceIDEnrollmentProfile(
  components: RealVoiceIDComponents,
  participantCode: string,
  profileId: string,
  signal?: AbortSignal
): Promise<{ readonly profileId: string; readonly referenceCount: number; readonly participantCode: string }> {
  const results = await components.runtime.importEnrollmentProfile(participantCode, signal);
  const embeddings = results.map((result) => {
    if (result.status !== "VALID") {
      throw new JarvisError("SPEAKER_EMBEDDING_FAILURE", 502, "VoiceID profile import failed.");
    }
    const embedding = {
      values: result.embedding,
      metadata: result.metadata,
      embeddingLatencyMs: 0
    };
    validateEmbedding(embedding);
    return embedding;
  });
  const profile = buildOwnerSpeakerProfile(profileId, embeddings, new Date().toISOString());
  await components.profiles.put(profile);
  return { profileId, referenceCount: embeddings.length, participantCode };
}

export function loadDevelopmentDecisionPolicy(
  environment: NodeJS.ProcessEnv = process.env
): ThresholdDecisionPolicy {
  if (environment.JARVIS_VOICEID_POLICY_MODE !== "DEVELOPMENT_ONLY") {
    throw new JarvisError(
      "SPEAKER_VERIFICATION_FAILURE",
      503,
      "Speaker verification requires an explicit calibrated policy or DEVELOPMENT_ONLY configuration."
    );
  }
  const authorizedThreshold = Number(environment.JARVIS_VOICEID_DEV_AUTHORIZED_THRESHOLD);
  const unauthorizedThreshold = Number(environment.JARVIS_VOICEID_DEV_UNAUTHORIZED_THRESHOLD);
  return new ThresholdDecisionPolicy({
    authorizedThreshold,
    unauthorizedThreshold,
    policyId: "development-only-explicit-v1"
  });
}

class EnrollmentOnlyDecisionPolicy {
  readonly policyId = "enrollment-only-no-decision";
  readonly calibrationRequired = true;
  decide(): never {
    throw new JarvisError(
      "SPEAKER_VERIFICATION_FAILURE",
      503,
      "Enrollment-only speaker policy cannot authorize an interaction."
    );
  }
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new JarvisError("SPEAKER_MODEL_UNAVAILABLE", 503, "VoiceID runtime configuration is invalid.");
  }
  return parsed;
}
