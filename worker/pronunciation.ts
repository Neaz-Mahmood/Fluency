import { voice } from "@livekit/agents";
import { AudioResampler, type AudioFrame } from "@livekit/rtc-node";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { createRequire } from "node:module";
import { ReadableStream } from "node:stream/web";

import type { PhraseResult } from "@/lib/pronunciation-score";
import { TimedAgent, type TurnTimeline } from "./timeline";
import { pcmDurationMs, SCORING_SAMPLE_RATE, type TurnAudioBuffer } from "./turn-audio";

// Node 26's global WebSocket fails against Azure (1006); make the SDK use its bundled `ws`.
createRequire(import.meta.url)(
  "microsoft-cognitiveservices-speech-sdk/distrib/lib/src/common.browser/WebsocketMessageAdapter.js",
).WebsocketMessageAdapter.forceNpmWebSocket = true;

export type AzureConfig = { key: string; region: string };

export function azureConfigFromEnv(): AzureConfig | null {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  return key && region ? { key, region } : null;
}

// Copies the learner's audio, resampled to 16 kHz, into the buffer the turns are cut from.
export async function collectTurnAudio(
  frames: ReadableStream<AudioFrame>,
  buffer: TurnAudioBuffer,
): Promise<void> {
  let resampler: AudioResampler | null = null;
  try {
    for await (const frame of frames) {
      if (frame.sampleRate !== SCORING_SAMPLE_RATE) {
        resampler ??= new AudioResampler(frame.sampleRate, SCORING_SAMPLE_RATE, 1);
        for (const resampled of resampler.push(frame)) {
          buffer.push(new Int16Array(resampled.data), Date.now());
        }
      } else {
        buffer.push(new Int16Array(frame.data), Date.now());
      }
    }
  } catch (error) {
    console.error("Could not read learner audio for scoring:", error);
  } finally {
    resampler?.close();
  }
}

// Scripted Azure assessment of one learner turn against its Flux transcript. The whole turn is
// sent at once, not in real time; see scripts/voice/azure-pron.ts assess() for the measured setup.
export async function assessScripted(
  pcm: Int16Array,
  referenceText: string,
  config: AzureConfig,
): Promise<PhraseResult[]> {
  const speechConfig = sdk.SpeechConfig.fromSubscription(config.key, config.region);
  speechConfig.speechRecognitionLanguage = "en-US";

  const pushStream = sdk.AudioInputStream.createPushStream(
    sdk.AudioStreamFormat.getWaveFormatPCM(SCORING_SAMPLE_RATE, 16, 1),
  );
  const recognizer = new sdk.SpeechRecognizer(
    speechConfig,
    sdk.AudioConfig.fromStreamInput(pushStream),
  );

  const pronConfig = sdk.PronunciationAssessmentConfig.fromJSON(
    JSON.stringify({
      referenceText,
      gradingSystem: "HundredMark",
      granularity: "Phoneme",
      phonemeAlphabet: "IPA",
      nBestPhonemeCount: 5,
      enableMiscue: false,
    }),
  );
  pronConfig.enableProsodyAssessment = true;
  pronConfig.applyTo(recognizer);

  return new Promise((resolve, reject) => {
    const phrases: PhraseResult[] = [];
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      recognizer.stopContinuousRecognitionAsync(
        () => recognizer.close(),
        () => recognizer.close(),
      );
      if (error) reject(error);
      else resolve(phrases);
    };

    const timeoutMs = 10_000 + pcmDurationMs(pcm.length);
    const timer = setTimeout(
      () => finish(new Error(`Azure pronunciation assessment timed out after ${timeoutMs} ms.`)),
      timeoutMs,
    );

    recognizer.recognized = (_sender, event) => {
      if (event.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
      const json = event.result.properties.getProperty(
        sdk.PropertyId.SpeechServiceResponse_JsonResult,
      );
      if (json) phrases.push(JSON.parse(json) as PhraseResult);
    };

    recognizer.canceled = (_sender, event) => {
      if (event.reason === sdk.CancellationReason.Error) {
        finish(new Error(`Azure recognition canceled: ${event.errorDetails}`));
      }
    };

    recognizer.sessionStopped = () => finish();

    recognizer.startContinuousRecognitionAsync(
      () => {
        // Exactly the PCM bytes, in a buffer of their own.
        pushStream.write(new Int16Array(pcm).buffer);
        pushStream.close();
      },
      (error) => finish(new Error(`Azure recognition failed to start: ${error}`)),
    );
  });
}

// The tutor agent, which also copies the learner's audio for pronunciation scoring. Flux gets the
// audio exactly as before; the copy is held only in memory until its turn is scored, never stored.
export class ScoringAgent extends TimedAgent {
  // A plain field, not a parameter property: Node's type stripping can't run those.
  private readonly turnAudio: TurnAudioBuffer;

  constructor(
    options: voice.AgentOptions<unknown>,
    timeline: TurnTimeline,
    turnAudio: TurnAudioBuffer,
  ) {
    super(options, timeline);
    this.turnAudio = turnAudio;
  }

  override async sttNode(
    audio: ReadableStream<AudioFrame> | AsyncIterable<AudioFrame>,
    modelSettings: voice.ModelSettings,
  ) {
    const stream = audio instanceof ReadableStream ? audio : ReadableStream.from(audio);
    const [forStt, copy] = stream.tee();
    void collectTurnAudio(copy, this.turnAudio);
    // TimedAgent's sttNode, which also reads Flux's word times for the timeline.
    return super.sttNode(forStt, modelSettings);
  }
}
