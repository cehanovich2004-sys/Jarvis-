export type MemoryCategory =
  | "USER_PREFERENCE"
  | "USER_SETTING"
  | "PROJECT_FACT"
  | "RELATIONSHIP_CONTEXT"
  | "WORKFLOW_PREFERENCE";

export type MemoryProvenanceKind =
  | "EXPLICIT_USER_INPUT"
  | "EXPLICIT_USER_CONFIGURATION";

export interface MemoryProvenance {
  readonly kind: MemoryProvenanceKind;
  readonly referenceId: string;
}

export interface MemoryCandidate {
  readonly category: MemoryCategory;
  readonly key: string;
  readonly value: string;
  readonly source: MemoryProvenance;
}

export interface MemoryWriteApproval {
  readonly status: "APPROVED";
  readonly actor: "USER";
  readonly approvalId: string;
}

export interface MemoryApprovalMetadata extends MemoryWriteApproval {
  readonly approvedAt: string;
}

export interface MemoryRecord extends MemoryCandidate {
  readonly id: string;
  readonly approval: MemoryApprovalMetadata;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface MemoryQuery {
  readonly categories?: readonly MemoryCategory[];
  readonly key?: string;
  readonly limit?: number;
}

export interface MemoryRetrievalResult {
  readonly trust: "UNTRUSTED_CONTEXT";
  readonly records: readonly MemoryRecord[];
}

export interface MemoryStoreLimits {
  readonly maxRecords: number;
  readonly maxTotalCharacters: number;
}

export interface LongTermMemoryStore {
  create(record: MemoryRecord, signal?: AbortSignal): Promise<MemoryRecord>;
  update(
    record: MemoryRecord,
    expectedVersion: number,
    signal?: AbortSignal
  ): Promise<MemoryRecord>;
  get(id: string, signal?: AbortSignal): Promise<MemoryRecord | undefined>;
  list(signal?: AbortSignal): Promise<readonly MemoryRecord[]>;
  delete(id: string, expectedVersion: number, signal?: AbortSignal): Promise<boolean>;
}

export interface LongTermMemoryServiceOptions {
  readonly now?: () => number;
  readonly idFactory?: () => string;
}

export interface ContextValue<T> {
  readonly source: "VERIFIED_LIVE" | "LONG_TERM_MEMORY";
  readonly value: T;
}
