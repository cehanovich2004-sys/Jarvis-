# Short-Term Conversation Context

Phase J9 adds explicit in-memory conversation sessions. A session has a validated ID, sliding TTL,
bounded turn count, bounded text budget, monotonically increasing turn sequence, and an explicit
delete operation. Expired sessions and evicted turns are not retained.

Each turn separates:

- normalized user text;
- assistant response text;
- structured outcome;
- closed tool-result summary;
- source and interaction-state metadata.

The contract has no raw audio or speaker-embedding fields. Credential-like assignments, control
characters, malformed commands, inconsistent tool summaries, and oversized turns are rejected.
Snapshots are defensive copies. The implementation is in-memory only and is replaced when the
process exits; J9 adds no persistent or long-term memory.

## Context Routing

The context-aware router keeps the current deterministic router first. It can resolve a deliberately
small set of exact follow-ups from structured recent outcomes, including `Теперь Finder` after an
application command and a power-source question after a verified battery result. Other `NO_MATCH`
turns receive a compact, bounded context summary through the J8 local intelligence provider.

Uncertain or non-success transcripts never use context or the model. Context-produced commands are
`INTENT_PROPOSAL` values only. They are not executed and cannot bypass structured validation,
`PermissionEngine`, identity verification, or `ToolRegistry`.

## Privacy And Lifecycle

Context includes only the newest useful structured turns that fit the configured builder budget; it
does not concatenate the entire session blindly. Store operations accept cancellation and reject a
pre-aborted signal before mutation. `delete` explicitly ends a session.
