import {
  AudioSession,
  EnergyVoiceActivityDetector,
  MacOSMicrophoneInput,
  type MicrophoneProcessRunner
} from "../audio/index.js";
import { DeterministicIntentRouter, PermissionEngine } from "../intents/index.js";
import {
  VoiceInteractionCoordinator,
  VoiceInteractionService,
  type SpeakerVerificationPort
} from "../interaction/index.js";
import {
  PersonalityInteractionResponseGenerator,
  createPersonalityEngine,
  loadPersonalityConfig
} from "../personality/index.js";
import { createLocalSpeechToTextService } from "../stt/index.js";
import {
  GetBatteryTool,
  MacOSOperationRunner,
  OpenApplicationTool,
  SafeActionExecutor,
  ToolRegistry
} from "../tools/index.js";
import { createLocalTextToSpeechService } from "../tts/index.js";
import { createRealVoiceIDComponents, type RealVoiceIDComponents } from "../voiceid/index.js";
import { loadLiveVoiceConfiguration } from "./config.js";
import { LiveVoiceMode } from "./service.js";

export interface MacOSLiveVoiceFactoryOptions {
  readonly speakerRecognition: SpeakerVerificationPort;
  readonly environment?: NodeJS.ProcessEnv;
  readonly microphoneRunner?: MicrophoneProcessRunner;
}

export interface RealMacOSLiveVoiceMode {
  readonly mode: LiveVoiceMode;
  readonly voiceId: RealVoiceIDComponents;
  close(): Promise<void>;
}

export function createRealMacOSLiveVoiceMode(
  environment: NodeJS.ProcessEnv = process.env
): RealMacOSLiveVoiceMode {
  const voiceId = createRealVoiceIDComponents(environment);
  const mode = createMacOSLiveVoiceMode({ speakerRecognition: voiceId.service, environment });
  return { mode, voiceId, close: () => voiceId.close() };
}

export function createMacOSLiveVoiceMode(options: MacOSLiveVoiceFactoryOptions): LiveVoiceMode {
  const environment = options.environment ?? process.env;
  const config = loadLiveVoiceConfiguration(environment);
  const registry = new ToolRegistry();
  const operationRunner = new MacOSOperationRunner();
  registry.register(new OpenApplicationTool(operationRunner));
  registry.register(new GetBatteryTool(operationRunner));
  const interaction = new VoiceInteractionService(
    {
      speakerRecognition: options.speakerRecognition,
      speechToText: createLocalSpeechToTextService({ environment }),
      intentRouter: new DeterministicIntentRouter(),
      actionExecutor: new SafeActionExecutor(new PermissionEngine(), registry),
      textToSpeech: createLocalTextToSpeechService({ environment })
    },
    new PersonalityInteractionResponseGenerator(
      createPersonalityEngine(environment),
      loadPersonalityConfig(environment).humorLevel
    )
  );
  return new LiveVoiceMode(
    () => new AudioSession(
      new MacOSMicrophoneInput({
        executable: config.microphoneExecutable,
        deviceIndex: config.microphoneDeviceIndex,
        ...(options.microphoneRunner === undefined ? {} : { runner: options.microphoneRunner })
      }),
      new EnergyVoiceActivityDetector({
        speechThreshold: config.speechThreshold,
        endSilenceMilliseconds: config.endSilenceMilliseconds
      }),
      {
        timeoutMilliseconds: config.captureTimeoutMilliseconds,
        preRollMilliseconds: config.preRollMilliseconds,
        limits: {
          maxDurationSeconds: config.maximumDurationSeconds,
          maxBufferBytes: 16_000 * config.maximumDurationSeconds * Float32Array.BYTES_PER_ELEMENT
        }
      }
    ),
    new VoiceInteractionCoordinator(interaction),
    config.ownerProfileId
  );
}

export function createMacOSMicrophoneDiagnostic(
  environment: NodeJS.ProcessEnv = process.env,
  runner?: MicrophoneProcessRunner
): AudioSession {
  const config = loadLiveVoiceConfiguration(environment);
  return new AudioSession(
    new MacOSMicrophoneInput({
      executable: config.microphoneExecutable,
      deviceIndex: config.microphoneDeviceIndex,
      ...(runner === undefined ? {} : { runner })
    }),
    new EnergyVoiceActivityDetector({
      speechThreshold: config.speechThreshold,
      endSilenceMilliseconds: config.endSilenceMilliseconds
    }),
    {
      timeoutMilliseconds: config.captureTimeoutMilliseconds,
      preRollMilliseconds: config.preRollMilliseconds,
      limits: {
        maxDurationSeconds: config.maximumDurationSeconds,
        maxBufferBytes: 16_000 * config.maximumDurationSeconds * Float32Array.BYTES_PER_ELEMENT
      }
    }
  );
}
