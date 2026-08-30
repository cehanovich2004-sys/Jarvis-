# Hybrid Intelligence And Cloud Escalation

Phase J13 keeps deterministic routing and local intelligence first. Known commands always remain
local. Unknown requests reach the local LLM before the inspectable `EscalationEngine` may authorize
a cloud request.

Modes are `LOCAL`, `HYBRID` (default), and `MAX`. `LOCAL` makes cloud calls impossible. `HYBRID`
requires an explicit reason: local model unavailable, low confidence, complex reasoning, repeated
local failure, or explicit user request. `MAX` may prefer cloud for explicit or complex work, but it
still cannot move deterministic commands to cloud.

Deterministic directives recognize Russian and English variants of “только локально”, “спроси GPT”,
“спроси старшего”, and “максимальный интеллект”. Directives are removed before deterministic routing,
so “спроси GPT, открой Safari” still resolves through the local allowlisted command path.

## Privacy Boundary

Every request must pass `PrivacyGate`. The validated request is registered internally and the cloud
provider rejects type-cast or forged approval objects. The gate rejects credentials, common provider
tokens, JWT/private-key material, raw audio, VoiceID/voice embeddings and profiles, biometrics,
filesystem paths, environment variables, and encoded blobs. Input, selected short-term context,
item count, and total characters are bounded.

J12 long-term memory is excluded from the J13 cloud request contract. No files, environment maps,
audio, embeddings, or tool results are included automatically.

## Provider And Results

`CloudLLMProvider` is replaceable. The optional OpenAI-compatible HTTPS runtime reads its API key only
from factory configuration and never places it in prompts, results, metadata, or errors. CI uses fake
runtimes and performs no external requests.

Cloud JSON is independently parsed against the closed `ANSWER`, `INTENT_PROPOSAL`, and `NO_RESULT`
contract. Unknown fields and malformed or hostile commands fail closed. Intent proposals are returned
as untrusted proposals only; the cloud module has no executor, PermissionEngine, ToolRegistry, shell,
filesystem, macOS automation, memory-write, or authentication dependency.

Timeouts, cancellation, unavailable models, runtime failures, and malformed responses use sanitized
structured errors. HYBRID/MAX may return a local result or safe `NO_RESULT` with a cloud failure code.
Caller cancellation remains explicit and is not swallowed as fallback.

Real cloud smoke is intentionally not run without an explicitly supplied key. Cost accounting,
caching, budgets, planning, and cloud tool execution remain out of scope.
