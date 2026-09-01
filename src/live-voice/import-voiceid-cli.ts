#!/usr/bin/env node
import { JarvisError } from "../errors.js";
import { createRealVoiceIDComponents, importVoiceIDEnrollmentProfile } from "../voiceid/index.js";
import { loadLiveVoiceConfiguration } from "./config.js";

const participantCode = process.argv[2];
const controller = new AbortController();
const cancel = (): void => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
const voiceId = createRealVoiceIDComponents(process.env, { enrollmentOnly: true });

try {
  if (participantCode === undefined || !/^P[0-9]{4}$/u.test(participantCode)) {
    throw new JarvisError("SPEAKER_PROFILE_INCOMPATIBLE", 422, "A valid VoiceID participant code is required.");
  }
  const result = await importVoiceIDEnrollmentProfile(
    voiceId,
    participantCode,
    loadLiveVoiceConfiguration().ownerProfileId,
    controller.signal
  );
  console.log(`IMPORTED ${result.referenceCount} references from VoiceID ${result.participantCode}.`);
  console.log(`JARVIS owner profile: ${result.profileId}. Raw audio was not copied.`);
  console.log("Calibration status: REQUIRED. No production threshold was selected.");
} catch (error) {
  const safe = error instanceof JarvisError
    ? error
    : new JarvisError("SPEAKER_VERIFICATION_FAILURE", 500, "VoiceID profile import failed.");
  console.error(`${safe.code}: ${safe.message}`);
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally {
  await voiceId.close();
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
