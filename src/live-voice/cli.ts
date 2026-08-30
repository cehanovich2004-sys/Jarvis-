#!/usr/bin/env node
import { JarvisError } from "../errors.js";
import { createMacOSMicrophoneDiagnostic } from "./factory.js";

const controller = new AbortController();
const cancel = (): void => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);

try {
  if (process.argv.includes("--microphone-smoke")) {
    console.log("LISTENING");
    const result = await createMacOSMicrophoneDiagnostic().run(controller.signal);
    if (result.state === "COMPLETE") {
      console.log(`CAPTURED ${result.audio.durationSeconds.toFixed(2)}s`);
      console.log("Raw audio discarded.");
    } else {
      console.log(result.state === "TIMEOUT" ? "NO_SPEECH" : "CANCELLED");
      process.exitCode = result.state === "TIMEOUT" ? 2 : 130;
    }
  } else {
    throw new JarvisError(
      "SPEAKER_MODEL_UNAVAILABLE",
      503,
      "Live voice identity runtime/profile is not configured. Run with --microphone-smoke to test capture only."
    );
  }
} catch (error) {
  const safe = error instanceof JarvisError
    ? error
    : new JarvisError("INTERNAL_ERROR", 500, "Live voice mode failed.");
  console.error(`${safe.code}: ${safe.message}`);
  process.exitCode = safe.statusCode >= 500 ? 1 : 2;
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
