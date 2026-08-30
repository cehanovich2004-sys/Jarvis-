# Barge-In And Conversational Interruption

Phase J11 adds an in-memory `VoiceInteractionCoordinator` that owns exactly one active interaction.
Starting a new interaction aborts the previous interaction with an internal, non-forgeable reason,
waits for its J7 result to settle, and then starts the new interaction through the complete identity,
STT, routing, permission, and tool pipeline.

An interrupted interaction finishes as `INTERRUPTED`, distinct from external `CANCELLED`. If tool
execution already completed, its verified result remains in the interrupted result while playback is
stopped. Work cancelled before execution cannot resume after stale async completion.

`VoiceInteractionService` automatically wraps its action executor with `ExclusiveActionExecutor`.
The wrapper serializes calls to the existing action executor. A queued request checks its abort signal
before invoking the delegate, so cancelled work is skipped. A running delegate holds the queue until
it settles even if the caller stops awaiting it. This prevents overlapping tool calls without changing
the PermissionEngine or ToolRegistry boundary.

The coordinator stores only an interaction ID, an abort controller, and the active result promise. It
does not store audio, transcripts, embeddings, commands, permissions, or tool results. It introduces
no wake-word listener, persistence, network access, shell access, or new macOS tool.
