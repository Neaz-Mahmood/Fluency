import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AccessToken } from "livekit-server-sdk";

import { percentile } from "./ttft.ts";

export const SAMPLE_RATE = 24_000;

// Voice IDs:
// Cartesia Katie (f)
export const CARTESIA_VOICE_KATIE = "f786b574-daa5-4673-aa0c-cbe3e8534c02";
// Cartesia Blake (m)
export const CARTESIA_VOICE_BLAKE = "a167e0f3-df7e-4d52-a9c3-f949145efdab";
// Gradium Everly (f)
export const GRADIUM_VOICE_EVERLY = "vjFyp2BcCyTlUmYb";
// Gradium Garrett (m)
export const GRADIUM_VOICE_GARRETT = "POBHtemksfWQbng0";
// Deepgram Aura-2 Athena (f)
export const AURA2_VOICE_ATHENA = "athena";
// Deepgram Aura-2 Apollo (m)
export const AURA2_VOICE_APOLLO = "apollo";

// Pricing (October 2026; check the pricing pages):
// - direct prices are the plan price divided by the plan's credits (Cartesia Startup $49 / 1.25M credits, Gradium S $43 / 900k credits; 1 credit = 1 character)
// - inference prices are LiveKit's Build-plan rates
export const PRICE_CARTESIA_DIRECT = 39.2;
export const PRICE_GRADIUM_DIRECT = 47.8;
export const PRICE_AURA2_INFERENCE = 30;
export const PRICE_CARTESIA_INFERENCE = 50;
export const PRICE_GRADIUM_INFERENCE = 48;

export type Chunk = { atMs: number; pcm: Int16Array };

export function toInt16(
  bytes: Uint8Array,
  carry: Uint8Array | null,
): { samples: Int16Array; carry: Uint8Array | null } {
  let totalLen = bytes.length;
  if (carry && carry.length > 0) {
    totalLen += carry.length;
  }
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  if (carry && carry.length > 0) {
    combined.set(carry, 0);
    offset = carry.length;
  }
  combined.set(bytes, offset);

  const rem = totalLen % 2;
  const evenLen = totalLen - rem;
  const sampleCount = evenLen / 2;
  const samples = new Int16Array(sampleCount);
  const view = new DataView(combined.buffer, combined.byteOffset, evenLen);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = view.getInt16(i * 2, true);
  }

  const nextCarry = rem > 0 ? combined.slice(evenLen) : null;
  return { samples, carry: nextCarry };
}

export function leadingSilenceMs(pcm: Int16Array, sampleRate: number, thresholdDbfs = -40): number {
  const totalDurationMs = (pcm.length / sampleRate) * 1000;
  if (pcm.length === 0) {
    return 0;
  }
  const windowSamples = Math.max(1, Math.round((sampleRate * 10) / 1000));
  for (let start = 0; start < pcm.length; start += windowSamples) {
    const end = Math.min(start + windowSamples, pcm.length);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const s = pcm[i];
      sumSq += s * s;
    }
    const count = end - start;
    const rms = Math.sqrt(sumSq / count);
    const dbfs = rms > 0 ? 20 * Math.log10(rms / 32768) : -Infinity;
    if (dbfs >= thresholdDbfs) {
      return (start / sampleRate) * 1000;
    }
  }
  return totalDurationMs;
}

export type Analysis = {
  firstAudioMs: number;
  leadingSilenceMs: number;
  perceivedMs: number;
  audioMs: number;
  totalMs: number;
};

export function analyze(chunks: Chunk[], sampleRate: number, totalMs: number): Analysis {
  let totalSamples = 0;
  for (const chunk of chunks) {
    totalSamples += chunk.pcm.length;
  }

  if (totalSamples === 0) {
    throw new Error("No audio received.");
  }

  const firstChunk = chunks.find((c) => c.pcm.length > 0);
  if (!firstChunk) {
    throw new Error("No audio received.");
  }
  const firstAudioMs = firstChunk.atMs;

  const fullPcm = new Int16Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    fullPcm.set(chunk.pcm, offset);
    offset += chunk.pcm.length;
  }

  const silenceMs = leadingSilenceMs(fullPcm, sampleRate);
  const audioMs = (totalSamples / sampleRate) * 1000;

  let perceivedMs = firstAudioMs + silenceMs;

  if (silenceMs < audioMs) {
    const firstAudibleSampleIndex = Math.round((silenceMs * sampleRate) / 1000);
    let sampleOffset = 0;
    for (const chunk of chunks) {
      const nextOffset = sampleOffset + chunk.pcm.length;
      if (firstAudibleSampleIndex >= sampleOffset && firstAudibleSampleIndex < nextOffset) {
        perceivedMs = Math.max(firstAudioMs + silenceMs, chunk.atMs);
        break;
      }
      sampleOffset = nextOffset;
    }
  }

  return {
    firstAudioMs,
    leadingSilenceMs: silenceMs,
    perceivedMs,
    audioMs,
    totalMs,
  };
}

export function pcmToWav(pcm: Int16Array, sampleRate: number): Buffer {
  const dataSize = pcm.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(1, 22); // NumChannels (1 for Mono)
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate (sampleRate * numChannels * bitsPerSample / 8)
  buffer.writeUInt16LE(2, 32); // BlockAlign (numChannels * bitsPerSample / 8)
  buffer.writeUInt16LE(16, 34); // BitsPerSample (16 bits)
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < pcm.length; i++) {
    buffer.writeInt16LE(pcm[i], 44 + i * 2);
  }

  return buffer;
}

export type Candidate = {
  label: string;
  route: "direct" | "inference";
  usdPerMillionChars: number;
  synth: Synth;
};

export type Row = {
  label: string;
  route: "direct" | "inference";
  runs: number;
  firstP50: number;
  firstP90: number;
  silenceP50: number;
  perceivedP50: number;
  perceivedP90: number;
  usdPerMillionChars: number;
};

export function summarize(candidate: Candidate, analyses: Analysis[]): Row {
  if (analyses.length === 0) {
    throw new Error("Cannot summarize empty analyses.");
  }
  const firsts = analyses.map((a) => a.firstAudioMs);
  const silences = analyses.map((a) => a.leadingSilenceMs);
  const perceiveds = analyses.map((a) => a.perceivedMs);

  return {
    label: candidate.label,
    route: candidate.route,
    runs: analyses.length,
    firstP50: Math.round(percentile(firsts, 50)),
    firstP90: Math.round(percentile(firsts, 90)),
    silenceP50: Math.round(percentile(silences, 50)),
    perceivedP50: Math.round(percentile(perceiveds, 50)),
    perceivedP90: Math.round(percentile(perceiveds, 90)),
    usdPerMillionChars: candidate.usdPerMillionChars,
  };
}

export function formatTable(rows: Row[]): string {
  const sorted = [...rows].sort((a, b) => a.perceivedP50 - b.perceivedP50);
  const headers = [
    "Voice",
    "Route",
    "Runs",
    "First audio p50",
    "First audio p90",
    "Silence p50",
    "Heard p50",
    "Heard p90",
    "$/1M chars",
  ];
  const stringRows = sorted.map((r) => [
    r.label,
    r.route,
    String(r.runs),
    `${Math.round(r.firstP50)}ms`,
    `${Math.round(r.firstP90)}ms`,
    `${Math.round(r.silenceP50)}ms`,
    `${Math.round(r.perceivedP50)}ms`,
    `${Math.round(r.perceivedP90)}ms`,
    String(r.usdPerMillionChars),
  ]);

  const colWidths = headers.map((header, colIndex) => {
    let max = header.length;
    for (const row of stringRows) {
      if (row[colIndex].length > max) {
        max = row[colIndex].length;
      }
    }
    return max;
  });

  const formatLine = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(colWidths[i]))
      .join("  ")
      .trimEnd();

  const lines = [formatLine(headers)];
  for (const row of stringRows) {
    lines.push(formatLine(row));
  }
  return lines.join("\n");
}

export const SENTENCES: string[] = [
  "Nice! So you went to Cox's Bazar with Rafi last winter. What did you eat there?",
  "That sounds busy. How long does the bus take from Mirpur to Motijheel in the morning?",
  "Oh, you bought a new phone for twelve thousand taka? Which one did you choose?",
  "Good question. We say 'I have lived in Chattogram for five years', not 'I am living'.",
  "Eid with the whole family sounds lovely. Did Nusrat's mother cook biryani?",
  "Right, the rickshaw was faster than the CNG. Do you usually take a rickshaw to work?",
  "Let's try that again slowly. Can you tell me about your weekend in Sylhet?",
  "Great job! You used the past tense correctly three times. Shall we practise some more?",
];

export type Synth = (
  text: string,
  signal: AbortSignal,
  onStart: () => void,
) => AsyncIterable<Uint8Array>;

async function* readBody(res: Response, vendor: string): AsyncGenerator<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error(`${vendor} returned an empty response body.`);
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

export function createCartesiaDirectSynth(apiKey: string, voiceId: string): Synth {
  return async function* (
    text: string,
    signal: AbortSignal,
    onStart: () => void,
  ): AsyncIterable<Uint8Array> {
    onStart();
    const res = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Cartesia-Version": "2026-08-14",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: "sonic-3",
        transcript: text,
        voice: { id: voiceId },
        language: "en",
        output_format: {
          container: "raw",
          encoding: "pcm_s16le",
          sample_rate: SAMPLE_RATE,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Cartesia returned status ${res.status}: ${errText.slice(0, 200)}`);
    }

    yield* readBody(res, "Cartesia");
  };
}

export function createGradiumDirectSynth(apiKey: string, voiceId: string): Synth {
  return async function* (
    text: string,
    signal: AbortSignal,
    onStart: () => void,
  ): AsyncIterable<Uint8Array> {
    onStart();
    const res = await fetch("https://api.gradium.ai/api/post/speech/tts", {
      method: "POST",
      signal,
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice_id: voiceId,
        model_name: "default",
        output_format: "pcm_24000",
        only_audio: true,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gradium returned status ${res.status}: ${errText.slice(0, 200)}`);
    }

    yield* readBody(res, "Gradium");
  };
}

type WebSocketOptions = {
  headers?: Record<string, string>;
};

type NodeWebSocketConstructor = new (
  url: string | URL,
  protocolsOrOptions?: string | string[] | WebSocketOptions,
) => WebSocket;

type QueueItem =
  { type: "chunk"; data: Uint8Array } | { type: "done" } | { type: "error"; error: unknown };

function createAsyncQueue<T>() {
  const queue: T[] = [];
  const waiters: Array<(item: T) => void> = [];

  return {
    push(item: T) {
      if (waiters.length > 0) {
        const resolve = waiters.shift()!;
        resolve(item);
      } else {
        queue.push(item);
      }
    },
    async next(): Promise<T> {
      if (queue.length > 0) {
        return queue.shift()!;
      }
      return new Promise<T>((resolve) => {
        waiters.push(resolve);
      });
    },
  };
}

export function createLiveKitInferenceSynth(token: string, model: string, voice: string): Synth {
  return async function* (
    text: string,
    signal: AbortSignal,
    onStart: () => void,
  ): AsyncIterable<Uint8Array> {
    const queue = createAsyncQueue<QueueItem>();
    let doneReceived = false;
    let closed = false;

    const url = `wss://agent-gateway.livekit.cloud/v1/tts?model=${encodeURIComponent(model)}`;
    const NodeWebSocket = WebSocket as unknown as NodeWebSocketConstructor;
    const ws = new NodeWebSocket(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const onAbort = () => {
      if (!closed) {
        closed = true;
        try {
          ws.close();
        } catch {}
        queue.push({ type: "error", error: new Error("Aborted") });
      }
    };

    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    ws.onopen = () => {
      try {
        ws.send(
          JSON.stringify({
            type: "session.create",
            sample_rate: "24000",
            encoding: "pcm_s16le",
            model,
            voice,
            language: "en",
            extra: {},
          }),
        );
        onStart();
        ws.send(
          JSON.stringify({
            type: "input_transcript",
            transcript: text + " ",
            generation_config: { model, voice, language: "en" },
            extra: {},
          }),
        );
        ws.send(JSON.stringify({ type: "session.flush" }));
      } catch (err) {
        queue.push({ type: "error", error: err });
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const dataStr = typeof event.data === "string" ? event.data : event.data.toString();
        const msg = JSON.parse(dataStr);
        if (msg.type === "output_audio" && typeof msg.audio === "string") {
          queue.push({ type: "chunk", data: Buffer.from(msg.audio, "base64") });
        } else if (msg.type === "done") {
          doneReceived = true;
          try {
            ws.send(JSON.stringify({ type: "session.close" }));
          } catch {}
          try {
            ws.close();
          } catch {}
          queue.push({ type: "done" });
        } else if (msg.type === "error") {
          const errorMsg =
            typeof msg.message === "string" ? msg.message : "LiveKit returned an error";
          queue.push({ type: "error", error: new Error(errorMsg) });
        }
      } catch (err) {
        queue.push({ type: "error", error: err });
      }
    };

    ws.onerror = (event: Event) => {
      if (!doneReceived && !closed) {
        const message = (event as { message?: string }).message ?? "WebSocket error";
        queue.push({ type: "error", error: new Error(message) });
      }
    };

    ws.onclose = () => {
      if (!doneReceived && !closed) {
        queue.push({
          type: "error",
          error: new Error("WebSocket closed before done was received"),
        });
      }
    };

    try {
      while (true) {
        const item = await queue.next();
        if (item.type === "chunk") {
          yield item.data;
        } else if (item.type === "done") {
          break;
        } else if (item.type === "error") {
          throw item.error;
        }
      }
    } finally {
      closed = true;
      signal.removeEventListener("abort", onAbort);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        try {
          ws.close();
        } catch {}
      }
    }
  };
}

export async function measure(
  synth: Synth,
  text: string,
  timeoutMs = 30_000,
): Promise<{ analysis: Analysis; pcm: Int16Array }> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    let t0 = performance.now();
    const onStart = () => {
      t0 = performance.now();
    };

    const iterable = synth(text, controller.signal, onStart);
    const chunks: Chunk[] = [];
    let carry: Uint8Array | null = null;
    let totalSamples = 0;

    for await (const byteChunk of iterable) {
      if (controller.signal.aborted) {
        throw new Error(`Timed out after ${timeoutMs} ms.`);
      }
      const atMs = performance.now() - t0;
      const { samples, carry: nextCarry } = toInt16(byteChunk, carry);
      carry = nextCarry;
      if (samples.length > 0) {
        chunks.push({ atMs, pcm: samples });
        totalSamples += samples.length;
      }
    }

    if (controller.signal.aborted) {
      throw new Error(`Timed out after ${timeoutMs} ms.`);
    }

    const totalMs = performance.now() - t0;
    const analysis = analyze(chunks, SAMPLE_RATE, totalMs);

    const fullPcm = new Int16Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      fullPcm.set(chunk.pcm, offset);
      offset += chunk.pcm.length;
    }

    return { analysis, pcm: fullPcm };
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out after ${timeoutMs} ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseArgs(argv: string[]): { runs: number; only?: string } {
  let runs = 8;
  let only: string | undefined = undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--runs" && i + 1 < argv.length) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        runs = Math.min(parsed, SENTENCES.length * 3);
      }
    } else if (arg.startsWith("--runs=")) {
      const parsed = Number.parseInt(arg.slice("--runs=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        runs = Math.min(parsed, SENTENCES.length * 3);
      }
    } else if (arg === "--only" && i + 1 < argv.length) {
      only = argv[i + 1];
    } else if (arg.startsWith("--only=")) {
      only = arg.slice("--only=".length);
    }
  }

  return { runs, only };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runs = args.runs;

  const candidates: Candidate[] = [];

  const cartesiaKey = process.env.CARTESIA_API_KEY;
  if (cartesiaKey) {
    candidates.push({
      label: "cartesia sonic-3 katie (f)",
      route: "direct",
      usdPerMillionChars: PRICE_CARTESIA_DIRECT,
      synth: createCartesiaDirectSynth(cartesiaKey, CARTESIA_VOICE_KATIE),
    });
    candidates.push({
      label: "cartesia sonic-3 blake (m)",
      route: "direct",
      usdPerMillionChars: PRICE_CARTESIA_DIRECT,
      synth: createCartesiaDirectSynth(cartesiaKey, CARTESIA_VOICE_BLAKE),
    });
  } else {
    console.log("Skipping direct Cartesia: set CARTESIA_API_KEY.");
  }

  const gradiumKey = process.env.GRADIUM_API_KEY;
  if (gradiumKey) {
    candidates.push({
      label: "gradium everly (f)",
      route: "direct",
      usdPerMillionChars: PRICE_GRADIUM_DIRECT,
      synth: createGradiumDirectSynth(gradiumKey, GRADIUM_VOICE_EVERLY),
    });
    candidates.push({
      label: "gradium garrett (m)",
      route: "direct",
      usdPerMillionChars: PRICE_GRADIUM_DIRECT,
      synth: createGradiumDirectSynth(gradiumKey, GRADIUM_VOICE_GARRETT),
    });
  } else {
    console.log("Skipping direct Gradium: set GRADIUM_API_KEY.");
  }

  const livekitKey = process.env.LIVEKIT_API_KEY;
  const livekitSecret = process.env.LIVEKIT_API_SECRET;
  if (livekitKey && livekitSecret) {
    try {
      const at = new AccessToken(livekitKey, livekitSecret, { identity: "tts-ab", ttl: 3600 });
      at.addInferenceGrant({ perform: true });
      const token = await at.toJwt();

      candidates.push({
        label: "aura-2 athena (f)",
        route: "inference",
        usdPerMillionChars: PRICE_AURA2_INFERENCE,
        synth: createLiveKitInferenceSynth(token, "deepgram/aura-2", AURA2_VOICE_ATHENA),
      });
      candidates.push({
        label: "aura-2 apollo (m)",
        route: "inference",
        usdPerMillionChars: PRICE_AURA2_INFERENCE,
        synth: createLiveKitInferenceSynth(token, "deepgram/aura-2", AURA2_VOICE_APOLLO),
      });
      candidates.push({
        label: "cartesia sonic-3 katie (f) via livekit",
        route: "inference",
        usdPerMillionChars: PRICE_CARTESIA_INFERENCE,
        synth: createLiveKitInferenceSynth(token, "cartesia/sonic-3", CARTESIA_VOICE_KATIE),
      });
      candidates.push({
        label: "gradium everly (f) via livekit",
        route: "inference",
        usdPerMillionChars: PRICE_GRADIUM_INFERENCE,
        synth: createLiveKitInferenceSynth(token, "gradium/default", GRADIUM_VOICE_EVERLY),
      });
    } catch (err) {
      console.warn(
        `Failed to generate LiveKit inference token: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    console.log("Skipping LiveKit Inference: set LIVEKIT_API_KEY and LIVEKIT_API_SECRET.");
  }

  let selectedCandidates = candidates;
  if (args.only) {
    const query = args.only.toLowerCase();
    selectedCandidates = candidates.filter((c) => c.label.toLowerCase().includes(query));
  }

  if (selectedCandidates.length === 0) {
    console.error("No candidate voices could run. Please set API keys.");
    process.exitCode = 2;
    return;
  }

  const totalSentenceChars = SENTENCES.reduce((sum, s) => sum + s.length, 0);
  const avgSentenceChars = totalSentenceChars / SENTENCES.length;
  const charsPerCandidate = Math.round((1 + runs) * avgSentenceChars);
  console.log(
    `Estimated budget per candidate: ~${charsPerCandidate} characters ((1 warm-up + ${runs} runs) × ~${Math.round(avgSentenceChars)} avg chars/sentence).\n`,
  );

  const rows: Row[] = [];

  for (const candidate of selectedCandidates) {
    console.log(`Benchmarking ${candidate.label} via ${candidate.route}...`);

    // One warm-up call on sentence 1, not recorded
    try {
      await measure(candidate.synth, SENTENCES[0]);
    } catch (err) {
      console.warn(
        `[${candidate.label}] Warm-up call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const outDir = resolve("out", "tts-ab", slug(candidate.label));
    mkdirSync(outDir, { recursive: true });

    const analyses: Analysis[] = [];
    let firstError: string | null = null;
    for (let i = 0; i < runs; i++) {
      const sentence = SENTENCES[i % SENTENCES.length];
      try {
        const { analysis, pcm } = await measure(candidate.synth, sentence);
        analyses.push(analysis);
        const wavPath = resolve(outDir, `${i + 1}.wav`);
        writeFileSync(wavPath, pcmToWav(pcm, SAMPLE_RATE));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        firstError ??= message;
        console.warn(`[${candidate.label}] Run ${i + 1}/${runs} failed: ${message}`);
      }
    }

    if (analyses.length === 0) {
      console.error(
        `[${candidate.label}] Candidate failed: all runs failed (first error: ${firstError ?? "unknown"}).`,
      );
    } else {
      rows.push(summarize(candidate, analyses));
    }
  }

  if (rows.length > 0) {
    console.log("\n" + formatTable(rows));
    console.log("\nWAV files written to out/tts-ab/<voice>/<run>.wav");
    console.log(
      "\nHeard = first audible sample, assuming playback starts on the first chunk. Direct routes reuse a warm HTTP connection; inference routes exclude WebSocket setup, as a pooled worker would. Gradium direct uses its REST endpoint; the worker would use its WebSocket.",
    );
  } else {
    console.error("All candidate runs failed.");
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    resolve(process.argv[1]) === fileURLToPath(import.meta.url))
) {
  await main();
}
