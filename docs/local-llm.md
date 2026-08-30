# Local LLM Foundation

Phase J8 adds an optional local intelligence fallback after the deterministic intent router returns
`NO_MATCH`. Known commands remain on the fast deterministic path and do not invoke a model.

The initial runtime is Ollama's local HTTP API at `http://127.0.0.1:11434/api/generate`. The
request is non-streaming, uses temperature zero, bounds generated tokens, and supplies a JSON
schema. JARVIS still parses and validates the returned JSON independently because model and runtime
output is always untrusted.

Official runtime references:

- <https://docs.ollama.com/api/generate>
- <https://docs.ollama.com/capabilities/structured-outputs>

## Configuration

```text
JARVIS_LOCAL_LLM_BACKEND=ollama
JARVIS_LOCAL_LLM_URL=http://127.0.0.1:11434/api/generate
JARVIS_LOCAL_MODEL=qwen2.5:7b
JARVIS_LOCAL_LLM_TIMEOUT_MS=30000
JARVIS_LOCAL_LLM_MAX_OUTPUT_TOKENS=512
```

The default model is a 7B multilingual class appropriate for the target 16 GB Apple Silicon device.
It is configurable and is not downloaded by JARVIS or CI.

## Security Boundary

The provider can return only an answer, a proposed allowlisted structured intent, or no result.
Intent proposals pass through the existing strict `StructuredCommand` validator. J8 never executes
the proposal and provides no shell, executable, filesystem, network-action, or macOS automation
capability to the model. A later caller must still pass any proposal through `PermissionEngine` and
`ToolRegistry`.

Input and output sizes are bounded. Obvious credential assignments and control characters are
rejected before prompting. Prompts, answers, and backend exception content are not logged.

## Runtime Status

CI uses deterministic fake runtimes and requires no model, GPU, or network. No Ollama or llama.cpp
binary/model was installed in the development environment, so a real local inference smoke test was
not available for this phase.
