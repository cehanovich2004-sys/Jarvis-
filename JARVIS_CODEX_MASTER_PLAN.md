# JARVIS Codex Master Plan

## Authority Model

Maxim is CEO and Product Owner.

External ChatGPT acts as CTO and accepts technical phases after GitHub review.

Codex lead and project agents are implementers. They do not assign the CTO verdict and do not authorize phase transitions.

## Phase Gate

Current authorized scope:

- Phase 0: project setup and team development model.
- Phase 1 first vertical slice: local Jarvis Core with a minimal command API and CLI.

Do not start Phase 2 until external CTO status is `APPROVED`.

## Phase 0

Required outcomes:

- Project-scoped Codex agents.
- Repository instructions in `AGENTS.md`.
- `README.md`, `PLANS.md`, and `SECURITY.md`.
- ADR-001 documenting the TypeScript core and future Swift clients.
- Local development scripts and automated checks.
- No GitHub merge, no push to `main`, no destructive Git operations.

## Phase 1 First Vertical Slice

Required outcomes:

- Minimal TypeScript project.
- Local Jarvis Core.
- `GET /health`.
- `POST /v1/commands`.
- `GET /v1/commands/:id`.
- CLI command: `jarvis ask "status"` equivalent for the Russian `status` command, with support for `jarvis ask "статус"`.
- Typed contracts.
- Input validation.
- Support only for commands `статус` and `помощь`.
- Correct error responses.
- Automated unit and integration tests.
- No secrets.
- Server bound only to loopback: `127.0.0.1` or an equivalent loopback interface.

SQLite is allowed only if it does not block the vertical slice. An in-memory repository is acceptable when documented as a current limitation.

## Explicitly Out Of Scope For This Increment

- iOS application.
- macOS GUI.
- Always-on microphone listening.
- Speech-to-text.
- Speech synthesis.
- App Intents.
- Real Apple Shortcut.
- External network access.
- Public server.
- Cloud queue.
- Real Codex SDK integration.
- macOS app control.
- Automatic Git push from JARVIS.
- LaunchAgent.
- Full filesystem access.
- Payments, messages, or actions on behalf of the user.

## Internal Review Sequence

Use the following order:

1. Developer implements the approved increment.
2. Apple Engineer performs read-only Apple platform research.
3. QA performs read-only verification.
4. Security/DevOps performs read-only verification.
5. Developer may receive one limited fix cycle for confirmed blockers.
6. Lead prepares branch and Draft PR for external CTO review.

Internal agents may return `PASS`, `COMMENTS`, or `BLOCKED`. Only the external CTO may return `APPROVED`.

