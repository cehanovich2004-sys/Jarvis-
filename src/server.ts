#!/usr/bin/env node
import { DEFAULT_HOST, parsePort } from "./config.js";
import { startJarvisServer } from "./http.js";

const port = parsePort(process.env.JARVIS_PORT);
const started = await startJarvisServer({ host: DEFAULT_HOST, port });

console.log(`Jarvis Core listening on http://${started.host}:${started.port}`);

process.on("SIGINT", () => {
  started.server.close(() => {
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  started.server.close(() => {
    process.exit(0);
  });
});

