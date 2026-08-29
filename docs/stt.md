# Local Speech-To-Text Runtime

JARVIS uses a typed STT boundary and keeps model-specific behavior outside the core. The first local
runtime target is `whisper.cpp` running its long-lived loopback server. This choice keeps inference
offline, supports multilingual Whisper models, and uses the project's Apple Silicon Metal and Core ML
paths without adding Python or native packages to the TypeScript dependency graph.

## Runtime Setup

Build `whisper.cpp` separately and download a multilingual `base` or `small` GGML model outside this
repository. Model weights must not be copied into JARVIS. Start the server on loopback only, for
example:

```bash
whisper-server --host 127.0.0.1 --port 8080 --model /local/model/path/ggml-base.bin --language auto
```

Configure JARVIS with environment variables:

```text
JARVIS_STT_BACKEND=whisper.cpp
JARVIS_STT_MODEL=base
JARVIS_STT_LANGUAGE=AUTO
JARVIS_STT_TIMEOUT_MS=30000
JARVIS_STT_ENDPOINT=http://127.0.0.1:8080/inference
```

`JARVIS_STT_MODEL` is a non-sensitive model identifier for result metadata, not a filesystem path.
The endpoint accepts only plain HTTP on `127.0.0.1`, `localhost`, or `::1`. Audio is copied, converted
to mono 16 kHz PCM16 WAV in memory, and posted without creating a temporary audio file.

## Current Boundary

The `whisper.cpp` server owns model startup, reuse, and shutdown. JARVIS bounds each request with a
configurable timeout and cancellation signal. CI uses deterministic fake runtimes and never downloads
a model. A real multilingual model smoke test is a manual local check and is not part of the standard
quality gate.

The transcript is untrusted data. J4 validates and returns it but does not route it to commands, shell,
tools, logging, persistence, or cloud services.
