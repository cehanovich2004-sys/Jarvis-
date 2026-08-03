import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DEFAULT_HOST, assertLoopbackHost } from "./config.js";
import type { CommandResponse, HealthResponse } from "./contracts.js";
import { JarvisCore } from "./core.js";
import { JarvisError, toJarvisError } from "./errors.js";
import { InMemoryCommandRepository } from "./repository.js";
import { assertCommandId, parseCreateCommandRequest } from "./validation.js";

const jsonLimitBytes = 16_384;
const version = "0.1.0";

export interface JarvisServerOptions {
  host?: string;
  port?: number;
  core?: JarvisCore;
}

export interface StartedJarvisServer {
  server: Server;
  host: string;
  port: number;
}

export function createJarvisHttpServer(core = new JarvisCore(new InMemoryCommandRepository()), bindHost: string = DEFAULT_HOST): Server {
  assertLoopbackHost(bindHost);
  const startedAt = process.hrtime.bigint();

  return createServer(async (request, response) => {
    try {
      await routeRequest(request, response, core, bindHost, startedAt);
    } catch (error) {
      sendError(response, toJarvisError(error));
    }
  });
}

export async function startJarvisServer(options: JarvisServerOptions = {}): Promise<StartedJarvisServer> {
  const host = options.host ?? DEFAULT_HOST;
  assertLoopbackHost(host);

  const server = createJarvisHttpServer(options.core, host);
  const port = options.port ?? 0;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Jarvis Core did not expose a TCP address.");
  }

  return { server, host: address.address, port: address.port };
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  core: JarvisCore,
  bindHost: string,
  startedAt: bigint
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${bindHost}`);

  if (method === "GET" && url.pathname === "/health") {
    const uptimeSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    const body: HealthResponse = {
      service: "jarvis-core",
      status: "ok",
      version,
      bindHost,
      storage: "memory",
      uptimeSeconds
    };
    sendJson(response, 200, body);
    return;
  }

  if (url.pathname === "/v1/commands") {
    if (method !== "POST") {
      throw new JarvisError("METHOD_NOT_ALLOWED", 405, "Use POST for /v1/commands.");
    }

    const payload = parseCreateCommandRequest(await readJson(request));
    const command = await core.ask(payload);
    const body: CommandResponse = { command };
    sendJson(response, 201, body);
    return;
  }

  const commandMatch = /^\/v1\/commands\/([^/]+)$/.exec(url.pathname);
  if (commandMatch !== null) {
    if (method !== "GET") {
      throw new JarvisError("METHOD_NOT_ALLOWED", 405, "Use GET for /v1/commands/:id.");
    }

    const rawId = commandMatch[1];
    if (rawId === undefined) {
      throw new JarvisError("COMMAND_NOT_FOUND", 404, "Command id was not provided.");
    }

    const id = decodeURIComponent(rawId);
    assertCommandId(id);
    const command = await core.getCommand(id);
    const body: CommandResponse = { command };
    sendJson(response, 200, body);
    return;
  }

  throw new JarvisError("ROUTE_NOT_FOUND", 404, "Route was not found.");
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > jsonLimitBytes) {
      throw new JarvisError("INVALID_PAYLOAD", 413, "JSON payload is too large.");
    }

    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") {
    throw new JarvisError("INVALID_JSON", 400, "Request body must be JSON.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new JarvisError("INVALID_JSON", 400, "Request body must be valid JSON.");
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function sendError(response: ServerResponse, error: JarvisError): void {
  sendJson(response, error.statusCode, error.toResponse());
}
