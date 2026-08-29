# Local Text-To-Speech

J6 converts structured response text into controllable local speech playback.

```text
SpeechRequest
  -> TextToSpeechService
  -> TextToSpeechAdapter
  -> TTSRuntimeClient
  -> macOS system speech
```

The initial backend uses `/usr/bin/say` through Node `spawn` with `shell: false`. Text is a dedicated
argument and never becomes a command line or shell fragment. The default voice is the local Russian
voice `Milena`; voice, rate, timeout, and maximum text length are configurable:

```text
JARVIS_TTS_BACKEND=macos-say
JARVIS_TTS_VOICE=Milena
JARVIS_TTS_RATE_WPM=180
JARVIS_TTS_TIMEOUT_MS=30000
JARVIS_TTS_MAX_CHARACTERS=1000
```

The adapter rejects empty, oversized, malformed, control-character, and unsupported-language input.
It snapshots normalized text before the asynchronous runtime boundary and maps backend failures to
safe `JarvisError` codes.

## Cancellation And Future Barge-In

Each playback receives an `AbortSignal`. The concrete process runner retains the active `say` child
and sends `SIGTERM` when playback is cancelled. Adapter timeout uses the same cancellation path while
preserving a distinct `TTS_TIMEOUT` result. This lifecycle allows a future voice loop to interrupt
speech without replacing the TTS backend contract.

CI uses deterministic fake runtimes and does not require audio output. Real local playback is a
separate smoke test.
