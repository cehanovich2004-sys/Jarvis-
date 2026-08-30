# Long-Term Memory

Phase J12 introduces durable, explicitly approved memory separately from J9 short-term conversation
context. Nothing in a conversation is persisted automatically. Callers must submit a closed
`MemoryCandidate` and a separate `MemoryWriteApproval` whose actor is `USER`.

Supported categories are user preferences, user settings, project facts, relationship context, and
workflow preferences. Every record contains a stable key, bounded value, explicit provenance,
approval metadata, timestamps, and an optimistic version. Create rejects duplicate category/key
pairs. Update and deletion require the expected current version and fail on conflicts.

## Privacy

Validation rejects credential-like keys and values, bearer tokens, common API token formats, JWTs,
private keys, authentication material, biometric identifiers, raw-audio concepts, speaker
embeddings, and transcript keys. Values are bounded to 500 normalized characters. Memory retrieval
is marked `UNTRUSTED_CONTEXT`; it grants no identity, permission, command, or tool authority.

Verified live data always has explicit precedence over remembered data through
`preferVerifiedLiveValue`. Memory is never wired into tool arguments or execution in J12.

## Stores And Retention

`LongTermMemoryStore` is replaceable. `InMemoryLongTermMemoryStore` is deterministic for CI.
`JsonFileLongTermMemoryStore` provides local persistence with bounded record/character capacity,
serialized in-process mutations, atomic temporary-file replacement, `0600` files, and a private
`0700` storage directory. It rejects symlinks, insecure permissions, malformed JSON, unknown schema
fields, invalid records, and over-capacity files without overwriting them.

Retention is explicit: records remain until a version-checked update or delete. J12 adds no cloud
memory, automatic profiling, full transcript archive, background collection, or cross-process lock.
