# Security

## Current Boundary

JARVIS Core is local-only in this increment.

- The HTTP server binds to `127.0.0.1` by default.
- Host validation rejects non-loopback bind hosts.
- No public server is created.
- No external network calls are made by the application.
- No secrets are required.
- No LaunchAgent, startup item, microphone listener, Apple Events automation, or filesystem automation is created.

## Input Handling

- API payloads are parsed as JSON with a size limit.
- Command payloads are validated before execution.
- Only `статус` and `помощь` are supported.
- Unsupported commands return structured errors.
- Command IDs are constrained to a small ASCII-safe identifier format.

## Persistence

The current repository is in-memory only. This avoids premature storage commitments in the first slice.

Future persistence must be reviewed for:

- local file path handling;
- database migrations;
- data retention;
- backup and deletion behavior;
- secrets handling.

## Future High-Risk Areas

The following require explicit CTO/security review before implementation:

- iOS or macOS native clients;
- App Intents;
- Vocal Shortcuts;
- microphone access;
- speech recognition;
- speech synthesis;
- local-network access between devices;
- Apple Events or macOS app control;
- real Codex SDK integration;
- external services;
- background launch behavior.

