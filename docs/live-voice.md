# Live Voice Mode Foundation

JV1 adds an explicit-start, one-shot macOS voice path around the existing production modules:

```text
ffmpeg microphone stream -> AudioSession -> energy VAD -> VoiceInteractionCoordinator
-> identity gate -> whisper.cpp STT -> deterministic safe tools -> personality -> macOS TTS
```

There is no wake word, always-on listener, terminal menu, raw-audio persistence, new tool scope, or
identity bypass. The microphone runtime uses an allowlisted absolute `ffmpeg` executable with
`spawn` and `shell: false`. It streams little-endian float32 PCM through stdout and emits bounded
mono 16 kHz chunks. `AudioSession` owns maximum duration, overall capture timeout, cancellation, and
cleanup. The replaceable energy VAD ends an utterance after a configurable trailing-silence period.

## Runtime Readiness

The target Mac currently has `/opt/homebrew/bin/ffmpeg`. A capture-only diagnostic is available:

```bash
pnpm jarvis:voice --microphone-smoke
```

Speak one phrase after `LISTENING`. The diagnostic validates completed audio and discards it without
identity, STT, tool execution, or persistence.

The normal command is:

```bash
pnpm jarvis:voice
```

It intentionally fails closed with `SPEAKER_MODEL_UNAVAILABLE` until a concrete JARVIS-side
`VoiceIDRuntimeClient`, an owner profile, and a calibrated production decision policy are configured.
J3 only established the typed runtime boundary and in-memory profile foundation. JV1 does not invent
thresholds, persist biometric profiles, or modify the read-only VoiceID repository.

The existing STT boundary expects a local whisper.cpp-compatible server at
`http://127.0.0.1:8080/inference` by default. Configure `JARVIS_STT_ENDPOINT`, `JARVIS_STT_MODEL`, and
`JARVIS_STT_LANGUAGE` when using another loopback endpoint/model. Model weights are not committed or
downloaded by CI. A multilingual Whisper model should be selected for Russian and mixed RU/EN input;
the exact local model remains an operator choice subject to latency and memory measurement on the
M4/16 GB target.

## Configuration

- `JARVIS_OWNER_PROFILE_ID` (default `owner-primary`)
- `JARVIS_MICROPHONE_FFMPEG` (`/opt/homebrew/bin/ffmpeg` or `/usr/local/bin/ffmpeg`)
- `JARVIS_MICROPHONE_DEVICE_INDEX` (default `0`)
- `JARVIS_VOICE_CAPTURE_TIMEOUT_MS` (default `15000`)
- `JARVIS_VOICE_MAX_DURATION_SECONDS` (default `30`, maximum `60`)
- `JARVIS_VAD_SPEECH_THRESHOLD` (default `0.015`)
- `JARVIS_VAD_END_SILENCE_MS` (default `700`)

`Ctrl+C` propagates cancellation to microphone capture. The interaction coordinator continues to
propagate the same signal through identity, STT, tool execution, and TTS once a concrete identity
runtime is available. Operational state observers expose lifecycle names but cannot alter execution.
