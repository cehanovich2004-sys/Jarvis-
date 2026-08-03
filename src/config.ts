export const DEFAULT_HOST = "127.0.0.1" as const;
export const DEFAULT_PORT = 3147;

export function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("JARVIS_PORT must be an integer between 0 and 65535.");
  }

  return port;
}

export function assertLoopbackHost(host: string): void {
  const normalized = host.trim().toLowerCase();
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

  if (!loopbackHosts.has(normalized)) {
    throw new Error("Jarvis Core may bind only to a loopback host.");
  }
}

