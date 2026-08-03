# ADR-001: TypeScript Local Core With Future Swift Clients

## Status

Accepted for Phase 0 and Phase 1 first vertical slice. External CTO approval is still required for phase acceptance.

## Context

JARVIS needs a small local core before any voice, Apple platform, or Codex SDK integration is introduced. The first increment must be easy to run, verify, and review without granting broad system permissions.

Future Apple clients may be written in Swift or SwiftUI, but creating those clients now would expand the phase and introduce platform permissions too early.

## Decision

Use TypeScript for the local JARVIS Core.

The core exposes typed contracts through a loopback-only HTTP API and a small CLI. Future Swift clients should treat these contracts as the integration boundary until a CTO-approved alternative exists.

Use an in-memory repository for the first slice. Persistence remains replaceable and must not be implied where it does not exist.

## Consequences

Positive:

- The first slice is reviewable with ordinary TypeScript tooling.
- Apple-specific permissions are avoided in the first increment.
- The same core behavior can serve the CLI and HTTP API.
- Future Swift DTOs can mirror the stable API contracts.

Tradeoffs:

- In-memory command history is lost on process exit.
- Future clients need a deliberate contract/versioning plan.
- A future iOS client cannot use `localhost` to reach a Mac-hosted core; that decision needs separate CTO/security review.

## Explicit Non-Decisions

- No iOS app.
- No macOS GUI.
- No App Intents.
- No Vocal Shortcuts.
- No microphone, speech recognition, or speech synthesis.
- No real Codex SDK integration.
- No external network access.

