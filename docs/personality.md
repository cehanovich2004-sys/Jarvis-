# Personality And Response Style

Phase J10 adds a deterministic presentation-only personality layer between factual response content
and the TTS `SpeechRequest`. It has no dependency on identity decisions, structured commands,
permissions, tool registries, executors, files, network, or shell access.

`ResponseContent` is a closed union of verified facts and fixed reason codes. The engine validates
exact runtime keys, formats RU-first or explicit English text, returns an immutable factual summary
for verification, and produces a bounded speech request. Hidden command, tool, permission, or shell
fields are rejected.

## Humor

`JARVIS_HUMOR_LEVEL` accepts:

- `0`: OFF
- `1`: LOW
- `2`: NORMAL, the default
- `3`: HIGH

NORMAL maps deterministic seeds to 80% neutral, 15% light irony, and 5% noticeable humor. If no
seed is supplied, a stable hash of validated content is used so repeated content is reproducible
while different responses can vary. Humor only appends a fixed presentation suffix; it cannot alter
or replace factual values.

Security denials, errors, uncertain outcomes, and clarifications are always neutral even at HIGH.
No movie dialogue or other copyrighted quotations are used.

`JARVIS_RESPONSE_MAX_CHARACTERS` defaults to 500. If a humorous variant exceeds the limit, the
engine falls back to the neutral response. It never truncates facts. Content whose neutral form does
not fit is rejected.

## J7 Adapter

`PersonalityInteractionResponseGenerator` implements the existing J7 response-generator contract.
It receives only terminal outcome categories and verified `ToolExecutionResult` values. Existing J7
identity, routing, permission, execution, cancellation, and TTS behavior remains unchanged.
