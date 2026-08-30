# Voice Interaction Orchestration

Phase J7 composes the existing audio, speaker verification, STT, deterministic intent, safe tool,
and TTS boundaries. It does not capture microphone input or add wake-word detection.

The successful state path is:

```text
START
-> VERIFYING_SPEAKER
-> TRANSCRIBING
-> UNDERSTANDING
-> EXECUTING
-> RESPONDING
-> COMPLETE
```

`UNAUTHORIZED` and `UNCERTAIN_IDENTITY` stop before transcription, routing, and tool execution.
`NO_SPEECH`, `UNCERTAIN_SPEECH`, and `NO_MATCH` stop before tool execution. These controlled
outcomes receive short deterministic Russian responses through the same cancellable TTS boundary.

A single optional `AbortSignal` is passed to speaker verification, STT, tool execution, and TTS.
The orchestration layer stops waiting immediately when it is aborted. Existing backends receive the
same signal where their contracts support cancellation. If cancellation occurs during response
playback after a tool has completed, the structured result preserves the verified execution result
without claiming that playback completed.

The interaction result contains the terminal state, transition trace, deterministic response,
playback result, and tool result where applicable. It intentionally excludes raw audio, embeddings,
transcript text, backend exception messages, and filesystem paths.
