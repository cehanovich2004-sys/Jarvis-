import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { JarvisError } from "../errors.js";
import {
  JARVIS_AUDIO_CHANNELS,
  JARVIS_AUDIO_SAMPLE_RATE,
  type AudioChunk
} from "./contracts.js";
import type { MicrophoneInput } from "./input.js";

const ALLOWED_FFMPEG_EXECUTABLES = new Set([
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg"
]);
const MAX_MICROPHONE_READ_BYTES = 1_048_576;

export interface MicrophoneProcessExit {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface MicrophoneCaptureProcess {
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly exited: Promise<MicrophoneProcessExit>;
  terminate(force?: boolean): void;
}

export interface MicrophoneProcessRunner {
  start(executable: string, arguments_: readonly string[]): MicrophoneCaptureProcess;
}

export interface MacOSMicrophoneInputOptions {
  readonly executable?: string;
  readonly deviceIndex?: number;
  readonly chunkMilliseconds?: number;
  readonly runner?: MicrophoneProcessRunner;
  readonly cleanupTimeoutMilliseconds?: number;
}

export class MacOSMicrophoneInput implements MicrophoneInput {
  readonly #executable: string;
  readonly #deviceIndex: number;
  readonly #samplesPerChunk: number;
  readonly #runner: MicrophoneProcessRunner;
  readonly #cleanupTimeoutMilliseconds: number;
  #process: MicrophoneCaptureProcess | null = null;
  #started = false;
  #closed = false;

  constructor(options: MacOSMicrophoneInputOptions = {}) {
    this.#executable = options.executable ?? "/opt/homebrew/bin/ffmpeg";
    this.#deviceIndex = options.deviceIndex ?? 0;
    const chunkMilliseconds = options.chunkMilliseconds ?? 100;
    this.#cleanupTimeoutMilliseconds = options.cleanupTimeoutMilliseconds ?? 1_000;
    if (
      !ALLOWED_FFMPEG_EXECUTABLES.has(this.#executable) ||
      !Number.isSafeInteger(this.#deviceIndex) ||
      this.#deviceIndex < 0 ||
      this.#deviceIndex > 32 ||
      !Number.isSafeInteger(chunkMilliseconds) ||
      chunkMilliseconds < 20 ||
      chunkMilliseconds > 1_000 ||
      !Number.isSafeInteger(this.#cleanupTimeoutMilliseconds) ||
      this.#cleanupTimeoutMilliseconds <= 0
    ) throw invalidConfiguration();
    this.#samplesPerChunk = JARVIS_AUDIO_SAMPLE_RATE * chunkMilliseconds / 1_000;
    if (!Number.isSafeInteger(this.#samplesPerChunk)) throw invalidConfiguration();
    this.#runner = options.runner ?? new NodeMicrophoneProcessRunner();
  }

  async *chunks(signal?: AbortSignal): AsyncIterable<AudioChunk> {
    if (this.#started || this.#closed) throw inputFailure();
    this.#started = true;
    if (signal?.aborted === true) return;
    let process: MicrophoneCaptureProcess;
    try {
      process = this.#runner.start(this.#executable, ffmpegArguments(this.#deviceIndex));
    } catch {
      throw inputFailure();
    }
    this.#process = process;
    const abort = (): void => process.terminate();
    signal?.addEventListener("abort", abort, { once: true });
    let carry: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    try {
      for await (const bytes of process.stdout) {
        if (this.#closed || isAborted(signal)) return;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_MICROPHONE_READ_BYTES) {
          throw inputFailure();
        }
        carry = concatenate(carry, bytes);
        const frameBytes = this.#samplesPerChunk * Float32Array.BYTES_PER_ELEMENT;
        while (carry.byteLength >= frameBytes) {
          yield audioChunkFromBytes(carry.subarray(0, frameBytes));
          carry = carry.slice(frameBytes);
        }
      }
      if (isAborted(signal) || this.#closed) return;
      if (carry.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) throw inputFailure();
      if (carry.byteLength > 0) yield audioChunkFromBytes(carry);
      const exit = await process.exited;
      if (exit.exitCode !== 0) throw inputFailure();
    } catch (error) {
      if (isAborted(signal) || this.#closed) return;
      if (error instanceof JarvisError) throw error;
      throw inputFailure();
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const process = this.#process;
    if (process === null) return;
    process.terminate();
    let settled = await settleWithin(process.exited, this.#cleanupTimeoutMilliseconds);
    if (!settled) {
      process.terminate(true);
      settled = await settleWithin(process.exited, this.#cleanupTimeoutMilliseconds);
    }
    this.#process = null;
    if (!settled) throw inputFailure();
  }
}

export class NodeMicrophoneProcessRunner implements MicrophoneProcessRunner {
  start(executable: string, arguments_: readonly string[]): MicrophoneCaptureProcess {
    if (!ALLOWED_FFMPEG_EXECUTABLES.has(executable)) throw invalidConfiguration();
    const child = spawn(executable, [...arguments_], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stderr.resume();
    return childProcessPort(child);
  }
}

export function ffmpegArguments(deviceIndex: number): readonly string[] {
  if (!Number.isSafeInteger(deviceIndex) || deviceIndex < 0 || deviceIndex > 32) {
    throw invalidConfiguration();
  }
  return [
    "-hide_banner", "-loglevel", "error",
    "-f", "avfoundation", "-i", `:${deviceIndex}`,
    "-vn", "-ac", String(JARVIS_AUDIO_CHANNELS),
    "-ar", String(JARVIS_AUDIO_SAMPLE_RATE),
    "-f", "f32le", "pipe:1"
  ];
}

function childProcessPort(child: ChildProcessByStdio<null, Readable, Readable>): MicrophoneCaptureProcess {
  const exited = new Promise<MicrophoneProcessExit>((resolve, reject) => {
    child.once("error", () => reject(inputFailure()));
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  return {
    stdout: child.stdout,
    exited,
    terminate: (force = false) => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(force ? "SIGKILL" : "SIGTERM");
      }
    }
  };
}

function concatenate(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>
): Uint8Array<ArrayBufferLike> {
  const combined = new Uint8Array(left.byteLength + right.byteLength);
  combined.set(left, 0);
  combined.set(right, left.byteLength);
  return combined;
}

function audioChunkFromBytes(bytes: Uint8Array<ArrayBufferLike>): AudioChunk {
  if (bytes.byteLength === 0 || bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw inputFailure();
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < samples.length; index += 1) {
    const value = view.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true);
    if (!Number.isFinite(value) || value < -1 || value > 1) throw inputFailure();
    samples[index] = value;
  }
  return {
    sampleRate: JARVIS_AUDIO_SAMPLE_RATE,
    channels: JARVIS_AUDIO_CHANNELS,
    format: "pcm-f32",
    samples
  };
}

function invalidConfiguration(): JarvisError {
  return new JarvisError("AUDIO_INPUT_FAILURE", 503, "Microphone configuration is unavailable.");
}

function inputFailure(): JarvisError {
  return new JarvisError("AUDIO_INPUT_FAILURE", 502, "Microphone capture failed.");
}

async function settleWithin(
  exited: Promise<MicrophoneProcessExit>,
  timeoutMilliseconds: number
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exited.then(() => true, () => false),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMilliseconds);
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
