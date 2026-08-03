#!/usr/bin/env node
import { JarvisCore } from "./core.js";
import { JarvisError, toJarvisError } from "./errors.js";
import { InMemoryCommandRepository } from "./repository.js";
import { parseCreateCommandRequest } from "./validation.js";

const [, , action, ...args] = process.argv;

if (action !== "ask") {
  printUsage();
  process.exitCode = 1;
} else {
  const text = args.join(" ").trim();

  try {
    const request = parseCreateCommandRequest({ text });
    const core = new JarvisCore(new InMemoryCommandRepository());
    const command = await core.ask(request);
    console.log(command.response);
  } catch (error) {
    const jarvisError = error instanceof JarvisError ? error : toJarvisError(error);
    console.error(`${jarvisError.code}: ${jarvisError.message}`);
    process.exitCode = jarvisError.statusCode >= 500 ? 1 : 2;
  }
}

function printUsage(): void {
  console.error('Usage: jarvis ask "статус"');
}

