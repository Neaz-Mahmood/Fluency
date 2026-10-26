import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";

import { isUuid } from "@/lib/learner-id";
import { isScenarioId, type ScenarioId } from "@/lib/scenarios";
import { AGENT_NAME } from "@/worker/job";

const TOPIC_TRANSCRIPTION = "lk.transcription";
const ATTRIBUTE_TRANSCRIPTION_FINAL = "lk.transcription_final";

export function parseCallArgs(
  argv: string[],
):
  | { learnerId: string; scenarioId: ScenarioId; sessionId: string | null; files: string[] }
  | { error: string } {
  let learnerId: string | undefined;
  let scenarioId: ScenarioId = "cafe";
  let sessionId: string | null = null;
  const files: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--learner") {
      learnerId = argv[++i];
    } else if (arg.startsWith("--learner=")) {
      learnerId = arg.slice("--learner=".length);
    } else if (arg === "--scenario") {
      const val = argv[++i];
      if (!val || !isScenarioId(val)) {
        return { error: `Invalid scenario: ${val}` };
      }
      scenarioId = val;
    } else if (arg.startsWith("--scenario=")) {
      const val = arg.slice("--scenario=".length);
      if (!isScenarioId(val)) {
        return { error: `Invalid scenario: ${val}` };
      }
      scenarioId = val;
    } else if (arg === "--session") {
      const val = argv[++i];
      if (!val || !isUuid(val)) {
        return { error: "Invalid session ID: must be a valid UUID" };
      }
      sessionId = val;
    } else if (arg.startsWith("--session=")) {
      const val = arg.slice("--session=".length);
      if (!isUuid(val)) {
        return { error: "Invalid session ID: must be a valid UUID" };
      }
      sessionId = val;
    } else if (!arg.startsWith("--")) {
      files.push(arg);
    }
  }

  if (!learnerId || !isUuid(learnerId)) {
    return { error: "Missing or invalid --learner: must be a valid UUID" };
  }

  if (files.length === 0) {
    return { error: "At least one audio file is required" };
  }

  return { learnerId, scenarioId, sessionId, files };
}

export function parseWav(buf: Buffer): { sampleRate: number; samples: Int16Array } {
  const afconvertHint = "Convert with: afconvert -f WAVE -d LEI16@24000 -c 1 in.m4a out.wav";

  if (buf.length < 12) {
    throw new Error(`Invalid WAV: file is too short (< 12 bytes). ${afconvertHint}`);
  }

  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Invalid WAV: missing RIFF/WAVE header. ${afconvertHint}`);
  }

  let offset = 12;
  let sampleRate: number | undefined;
  let channels: number | undefined;
  let bitsPerSample: number | undefined;
  let audioFormat: number | undefined;
  let pcm: Buffer | undefined;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = Math.min(buf.length, dataStart + chunkSize);

    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        throw new Error(`Invalid WAV: fmt chunk is too small (< 16 bytes). ${afconvertHint}`);
      }
      audioFormat = buf.readUInt16LE(dataStart);
      // WAVE_FORMAT_EXTENSIBLE (what current afconvert writes): the real format is the
      // first two bytes of the SubFormat GUID.
      if (audioFormat === 0xfffe && chunkSize >= 40) {
        audioFormat = buf.readUInt16LE(dataStart + 24);
      }
      channels = buf.readUInt16LE(dataStart + 2);
      sampleRate = buf.readUInt32LE(dataStart + 4);
      bitsPerSample = buf.readUInt16LE(dataStart + 14);
    } else if (chunkId === "data") {
      pcm = buf.subarray(dataStart, dataEnd);
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    offset = dataStart + paddedSize;
  }

  if (
    audioFormat === undefined ||
    sampleRate === undefined ||
    channels === undefined ||
    bitsPerSample === undefined
  ) {
    throw new Error(`Invalid WAV: missing fmt chunk. ${afconvertHint}`);
  }

  if (!pcm) {
    throw new Error(`Invalid WAV: missing data chunk. ${afconvertHint}`);
  }

  if ((audioFormat !== 1 && audioFormat !== 65534) || channels !== 1 || bitsPerSample !== 16) {
    throw new Error(
      `Invalid WAV format: expected 16-bit mono PCM (got format=${audioFormat}, channels=${channels}, bits=${bitsPerSample}). ${afconvertHint}`,
    );
  }

  const copy = Buffer.from(pcm);
  const samples = new Int16Array(copy.buffer, copy.byteOffset, Math.floor(copy.length / 2));

  return { sampleRate, samples };
}

async function playAudioFrames(source: AudioSource, samples: Int16Array, sampleRate: number) {
  const samplesPerFrame = Math.round(sampleRate * 0.01);
  const frameDurationMs = 10;
  let nextTime = performance.now();

  for (let offset = 0; offset < samples.length; offset += samplesPerFrame) {
    const end = Math.min(offset + samplesPerFrame, samples.length);
    // A copy, not a subarray view: AudioFrame reads from the start of the underlying buffer.
    const chunk = samples.slice(offset, end);
    const frame = new AudioFrame(chunk, sampleRate, 1, chunk.length);
    await source.captureFrame(frame);

    nextTime += frameDurationMs;
    const delay = nextTime - performance.now();
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function main(): Promise<void> {
  const LIVEKIT_URL = process.env.LIVEKIT_URL;
  const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
  const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    console.error("Missing LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET in environment.");
    process.exit(2);
  }

  const args = parseCallArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(`Invalid arguments: ${args.error}`);
    process.exit(2);
  }

  const { learnerId, scenarioId, sessionId, files } = args;

  const audioFiles: Array<{ file: string; sampleRate: number; samples: Int16Array }> = [];
  for (const file of files) {
    try {
      const buf = readFileSync(file);
      const parsed = parseWav(buf);
      audioFiles.push({ file, ...parsed });
    } catch (err) {
      console.error(
        `Could not read/parse WAV file "${file}": ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(2);
    }
  }

  // One AudioSource plays every file, so they must share a sample rate.
  const sampleRate = audioFiles[0].sampleRate;
  const mismatched = audioFiles.find((item) => item.sampleRate !== sampleRate);
  if (mismatched) {
    console.error(
      `"${mismatched.file}" is ${mismatched.sampleRate} Hz; every file must be ${sampleRate} Hz.`,
    );
    process.exit(2);
  }
  const room = `call-${Date.now()}`;

  await new AgentDispatchClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).createDispatch(
    room,
    AGENT_NAME,
    {
      metadata: JSON.stringify({ learnerId, scenarioId, sessionId }),
    },
  );

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: "voice-call" });
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true });

  const r = new Room();

  // Agents publish transcripts as text streams; log the final segments of both sides.
  r.registerTextStreamHandler(TOPIC_TRANSCRIPTION, (reader, participant) => {
    if (reader.info.attributes?.[ATTRIBUTE_TRANSCRIPTION_FINAL] !== "true") return;
    void reader.readAll().then((text) => console.log(`${participant.identity}: ${text}`));
  });

  await r.connect(LIVEKIT_URL, await at.toJwt());

  const source = new AudioSource(sampleRate, 1);
  const track = LocalAudioTrack.createAudioTrack("mic", source);
  await r.localParticipant!.publishTrack(
    track,
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
  );

  // Wait 4 s after publishing so the agent can join.
  await new Promise((resolve) => setTimeout(resolve, 4000));

  for (const item of audioFiles) {
    await playAudioFrames(source, item.samples, item.sampleRate);
    console.log(`played ${item.file}`);
    // 8 s of silence, so the agent can answer before the next turn.
    await playAudioFrames(source, new Int16Array(sampleRate * 8), sampleRate);
  }

  // After the last file, wait 3 s, disconnect, and exit 0.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await r.disconnect();
  process.exit(0);
}

if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    resolve(process.argv[1]) === fileURLToPath(import.meta.url))
) {
  await main();
}
