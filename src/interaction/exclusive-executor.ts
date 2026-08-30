import type { ActionExecutorPort } from "./contracts.js";

export class ExclusiveActionExecutor implements ActionExecutorPort {
  readonly #delegate: ActionExecutorPort;
  #tail: Promise<void> = Promise.resolve();

  constructor(delegate: ActionExecutorPort) {
    this.#delegate = delegate;
  }

  execute(
    command: Parameters<ActionExecutorPort["execute"]>[0],
    signal?: AbortSignal
  ): Promise<Awaited<ReturnType<ActionExecutorPort["execute"]>>> {
    const operation = this.#tail.then(async () => {
      throwIfAborted(signal);
      return this.#delegate.execute(command, signal);
    });
    this.#tail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason ?? new Error("Tool execution was cancelled.");
  }
}
