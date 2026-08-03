# JARVIS Core

JARVIS Core is currently a local-only TypeScript service for the first vertical slice of Phase 1.

It provides:

- `GET /health`
- `POST /v1/commands`
- `GET /v1/commands/:id`
- CLI command `jarvis ask "статус"` and `jarvis ask "помощь"`
- Typed command contracts
- Input validation and structured errors
- In-memory command storage
- Loopback-only server binding

## Requirements

- Node.js 24 or newer
- pnpm 11 or newer

In this Codex workspace, use the bundled pnpm if system pnpm is unavailable:

```bash
/Users/maxim/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm install
```

## Development

```bash
pnpm install
pnpm build
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
```

## Run The Server

```bash
pnpm build
pnpm start
```

The server listens on `127.0.0.1` by default. The port defaults to `3147` and may be changed with `JARVIS_PORT`.

## CLI

```bash
pnpm build
pnpm jarvis ask "статус"
pnpm jarvis ask "помощь"
```

The local package binary is linked into `node_modules/.bin` during install/build. To run the exact command shape locally:

```bash
PATH="$(pwd)/node_modules/.bin:$PATH"
jarvis ask "статус"
```

## API Examples

```bash
curl http://127.0.0.1:3147/health
```

```bash
curl -s http://127.0.0.1:3147/v1/commands \
  -H 'content-type: application/json' \
  -d '{"text":"статус"}'
```

```bash
curl http://127.0.0.1:3147/v1/commands/<command-id>
```

## Current Limitations

- Command records are stored in memory and disappear when the process exits.
- Only `статус` and `помощь` are supported.
- No iOS, macOS GUI, voice, App Intents, Apple Shortcuts, Codex SDK, external network access, or app-control integration exists in this increment.
- The service is intentionally local-only.
