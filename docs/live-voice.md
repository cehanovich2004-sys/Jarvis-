# Live Voice Mode

JV1/JV2 provide an explicit-start, one-shot macOS voice path around existing production modules:

```text
ffmpeg microphone stream -> AudioSession -> energy VAD -> VoiceInteractionCoordinator
-> VoiceID identity gate -> whisper.cpp STT -> deterministic safe tools -> personality -> macOS TTS
```

There is no wake word, always-on listener, raw-audio persistence, new tool scope, or identity bypass.
The microphone and managed runtime processes use fixed executables, `spawn`, and `shell: false`.
`AudioSession` owns maximum duration, timeout, cancellation, and cleanup.

## Local Setup

Runtime files stay outside Git:

```bash
brew install ffmpeg whisper-cpp
mkdir -p "$HOME/.jarvis/models/whisper"
curl -L --fail https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin \
  -o "$HOME/.jarvis/models/whisper/ggml-base.bin"
chmod 600 "$HOME/.jarvis/models/whisper/ggml-base.bin"
```

VoiceID is expected in the sibling `../VoiceID` directory with its existing `.venv` and pinned
offline cache at `$HOME/.cache/voiceid/speechbrain_ecapa`. VoiceID remains read-only. Override local
paths only when necessary:

```text
JARVIS_VOICEID_PROJECT_ROOT
JARVIS_VOICEID_PYTHON
JARVIS_VOICEID_CACHE_DIR
JARVIS_OWNER_PROFILE_PATH
JARVIS_WHISPER_SERVER
JARVIS_WHISPER_MODEL_PATH
```

JV2 runs VoiceID preprocessing, ECAPA extraction, and cosine comparison in a private long-lived
Python bridge. The model loads once and the bridge terminates on cancellation. It does not write
audio or log embeddings.

## Enrollment

Enroll the owner from three explicit microphone samples:

```bash
pnpm jarvis:voice:enroll
```

Delete the local profile with `pnpm jarvis:voice:enroll -- --delete`. Enrollment audio exists only
in memory until embeddings are extracted. The atomic local profile has `0600` permissions and stores
embeddings plus compatibility metadata, never raw audio.

An existing VoiceID enrollment can instead be imported explicitly by participant code. The bridge
opens the VoiceID database read-only, derives fresh embeddings through the unchanged VoiceID
pipeline, and copies neither WAV files nor the participant database into JARVIS:

```bash
pnpm jarvis:voice:import-voiceid -- P0001
```

Replace `P0001` with the owner code supplied by the operator. JARVIS never searches for a likely
owner or imports multiple participants automatically.

## Development-Only Policy

VoiceID has no approved production threshold. Voice mode fails closed unless a future calibrated
policy exists or the operator explicitly opts into development evaluation:

```bash
JARVIS_VOICEID_POLICY_MODE=DEVELOPMENT_ONLY \
JARVIS_VOICEID_DEV_AUTHORIZED_THRESHOLD=0.4 \
JARVIS_VOICEID_DEV_UNAUTHORIZED_THRESHOLD=0.2 \
pnpm jarvis:voice
```

These values are an explicit development configuration, not a production recommendation or
calibration. `calibrationRequired` remains true. The current multi-reference policy uses maximum
similarity; future calibration must evaluate aggregation with FAR, FRR, and EER.

## Running

A capture-only diagnostic remains available:

```bash
pnpm jarvis:voice -- --microphone-smoke
```

AVFoundation device indexes are host-dependent. List them before the first run and set the audio
device index explicitly when index `0` is not the intended microphone:

```bash
ffmpeg -hide_banner -f avfoundation -list_devices true -i ''
JARVIS_MICROPHONE_DEVICE_INDEX=1 pnpm jarvis:voice -- --microphone-smoke
```

The energy threshold is also device-dependent. Tune it only from measured local microphone levels;
do not lower it merely to force a successful identity smoke.

Normal one-shot mode starts a managed loopback-only whisper.cpp server, waits for readiness, runs one
complete interaction, and terminates every owned process:

```bash
pnpm jarvis:voice
```

Configuration:

- `JARVIS_OWNER_PROFILE_ID` (default `owner-primary`)
- `JARVIS_MICROPHONE_FFMPEG` (`/opt/homebrew/bin/ffmpeg` or `/usr/local/bin/ffmpeg`)
- `JARVIS_MICROPHONE_DEVICE_INDEX` (default `0`)
- `JARVIS_VOICE_CAPTURE_TIMEOUT_MS` (default `15000`)
- `JARVIS_VOICE_MAX_DURATION_SECONDS` (default `30`, maximum `60`)
- `JARVIS_VAD_SPEECH_THRESHOLD` (default `0.015`)
- `JARVIS_VAD_END_SILENCE_MS` (default `700`)
- `JARVIS_STT_ENDPOINT` (default `http://127.0.0.1:8080/inference`)
- `JARVIS_STT_LANGUAGE` (`AUTO`, `RU`, or `EN`)

`Ctrl+C` propagates through microphone capture, VoiceID inference, STT, interaction, and TTS.
Operational states contain no raw audio, embeddings, model prompts, or secrets.
Set `JARVIS_VOICE_SHOW_TRANSCRIPT=1` or `JARVIS_VOICE_SHOW_IDENTITY_SCORE=1` only for an attended
local diagnostic. Error output exposes a bounded JARVIS error code, never backend output.
