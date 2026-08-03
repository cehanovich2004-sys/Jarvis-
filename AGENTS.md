# AGENTS.md

## Project Roles

Maxim is CEO and Product Owner.

External ChatGPT acts as CTO for phase acceptance after GitHub review.

Codex lead and project agents are implementers. They must not assign an `APPROVED` status, merge, push to `main`, or authorize phase transitions.

## Phase Gate

The current allowed scope is Phase 0 plus the first local core vertical slice of Phase 1 from `JARVIS_CODEX_MASTER_PLAN.md`.

Do not begin Phase 2 without an external CTO status of `APPROVED`.

When reporting internal outcomes, use only:

- `READY FOR CTO REVIEW`
- `INTERNAL COMMENTS`
- `BLOCKED`

## Repository Boundaries

- Work only inside the project workspace.
- Do not modify or delete unrelated files.
- Do not use `danger-full-access`.
- Do not write secrets to source, configuration, docs, tests, logs, or examples.
- Do not implement external network access in the first increment.
- Do not create LaunchAgents, startup items, always-on listeners, voice APIs, iOS/macOS apps, App Intents, or real Codex SDK integrations in the first increment.
- The server must bind only to loopback, preferably `127.0.0.1`.

## Implementation Rules

- Use TypeScript for the local core.
- Keep changes minimal and verifiable.
- Prefer typed contracts over ad hoc shapes.
- Validate external input before processing it.
- Keep persistence replaceable. If in-memory storage is used, document it clearly.
- Support only `статус` and `помощь` commands in the first vertical slice.
- Return structured errors for invalid payloads, unknown commands, conflicts, and missing resources.

## Agent Responsibilities

`jarvis_developer` owns implementation of approved increments. It may edit project files, tests, and docs, but it must not merge, push to `main`, start future phases, or fix external CTO comments without a concrete list of requested changes.

`jarvis_apple_engineer` is read-only in this increment. It researches future macOS/iOS, SwiftUI, App Intents, and Vocal Shortcuts boundaries, and must not create an Apple app or change core code.

`jarvis_qa` is read-only. It verifies requirements, runs tests, checks API and CLI behavior, and reports `QA: PASS`, `QA: COMMENTS`, or `QA: BLOCKED`.

`jarvis_security` is read-only. It reviews loopback binding, secrets, validation, paths, commands, logging, network exposure, sandbox posture, and unauthorized autostart, then reports `SECURITY: PASS`, `SECURITY: COMMENTS`, or `SECURITY: BLOCKED`.

## Required Checks

Use the bundled Codex runtime when system Node.js or pnpm are unavailable.

Minimum commands for this increment:

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Additional manual checks must cover:

- `GET /health`
- successful `статус`
- successful `помощь`
- invalid payload
- unknown command
- duplicate command ID if supported by the contract
- actual network bind
- absence of secrets and unrelated files

Do not claim a check passed unless the command actually ran.

