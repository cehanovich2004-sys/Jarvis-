# Fast Intent And Safe macOS Tools

J5 introduces a deterministic path from a validated transcript to a verified tool result. It does not
use an LLM and does not execute transcript text.

```text
TranscriptResult
  -> DeterministicIntentRouter
  -> StructuredCommand validation
  -> PermissionEngine
  -> ToolRegistry
  -> Safe macOS operation
  -> verified ToolExecutionResult
```

## Initial Scope

The first allowlist contains only:

- `OPEN_APPLICATION` for `Safari` and `Finder`;
- `GET_BATTERY`.

Both intents are classified `LOW`. Unknown, uncertain, malformed, injected, or non-allowlisted input
fails closed without executing a tool.

## Execution Boundary

The macOS runner accepts a closed operation union rather than executable names or arguments. It maps
only to these fixed invocations:

```text
/usr/bin/open  -a <allowlisted application>
/usr/bin/pgrep -x <allowlisted application>
/usr/bin/pmset -g batt
```

Node's `execFile` is used directly without a shell. Output, duration, and executable paths are bounded
in production code. Opening an application is reported successful only when `pgrep` returns at least
one numeric process identifier. Battery output must contain a valid percentage and an exact macOS
power-source line.

No transcript, LLM response, or caller-provided value can become an executable, shell fragment, or
unvalidated argument.
