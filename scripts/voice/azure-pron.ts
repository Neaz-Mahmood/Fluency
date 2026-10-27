import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AZURE_TO_CATALOG,
  BN_EN_PRONUNCIATION_PATTERNS,
  findPattern,
} from "../../lib/pronunciation-patterns.ts";
import {
  phonemeMismatches,
  weakWords,
  type PhonemeMismatch as Mismatch,
  type PhraseResult,
} from "../../lib/pronunciation-score.ts";
import { percentile } from "./ttft.ts";

export { AZURE_TO_CATALOG } from "../../lib/pronunciation-patterns.ts";
export { phonemeMismatches, weakWords } from "../../lib/pronunciation-score.ts";
export type {
  PhonemeMismatch as Mismatch,
  PhonemeResult,
  PhraseResult,
  WordResult,
} from "../../lib/pronunciation-score.ts";

// Node 26's global WebSocket fails against Azure (1006); make the SDK use its bundled `ws`.
createRequire(import.meta.url)(
  "microsoft-cognitiveservices-speech-sdk/distrib/lib/src/common.browser/WebsocketMessageAdapter.js",
).WebsocketMessageAdapter.forceNpmWebSocket = true;

export const READING_PARAGRAPH =
  "Last Friday my friend Zara and I visited the zoo near Mirpur. It was very busy, so we waited in the shade and drank some coffee. She showed me a video of seven white swans on the west lake. Then we took a bus from the station back to the city and bought a cake and a cup of tea for her brother. I think the weather was better than the weather this time last year. Wasn't it a lovely day?";

export function parseWav(buf: Buffer): {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  pcm: Buffer;
} {
  const afconvertHint =
    "Convert with: afconvert -f WAVE -d LEI16@16000 -c 1 in.m4a out/azure-pron/clips/<name>.wav";

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

  if (audioFormat !== 1 || sampleRate !== 16000 || channels !== 1 || bitsPerSample !== 16) {
    throw new Error(
      `Invalid WAV format: expected 16kHz 16-bit mono PCM (got format=${audioFormat}, rate=${sampleRate}, channels=${channels}, bits=${bitsPerSample}). ${afconvertHint}`,
    );
  }

  return { sampleRate, channels, bitsPerSample, pcm };
}

export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(1, 22); // NumChannels (1 for Mono)
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate (sampleRate * 1 * 16 / 8)
  buffer.writeUInt16LE(2, 32); // BlockAlign (1 * 2)
  buffer.writeUInt16LE(16, 34); // BitsPerSample (16 bits)
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  return buffer;
}

export function gateCheck(
  audioMs: number,
  text: string,
): { seconds: number; words: number; sentences: number; ok: boolean } {
  const seconds = Math.round(audioMs / 100) / 10;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const runs = text.match(/[.?!]+/g);
  const sentences = words === 0 ? 0 : runs ? runs.length : 1;
  const ok = seconds >= 20 && words >= 50 && sentences >= 3;
  return { seconds, words, sentences, ok };
}

export function capabilities(phrases: PhraseResult[]): Record<string, boolean> {
  const caps: Record<string, boolean> = {
    AccuracyScore: false,
    FluencyScore: false,
    ProsodyScore: false,
    CompletenessScore: false,
    PronScore: false,
    "word.AccuracyScore": false,
    "word.ErrorType": false,
    "word.Feedback.Prosody.Break": false,
    "word.Feedback.Prosody.Intonation": false,
    "word.Syllables": false,
    "word.Phonemes": false,
    "phoneme.NBestPhonemes": false,
  };

  for (const phrase of phrases) {
    for (const nb of phrase.NBest ?? []) {
      const pa = nb.PronunciationAssessment;
      if (pa) {
        if (typeof pa.AccuracyScore === "number") caps["AccuracyScore"] = true;
        if (typeof pa.FluencyScore === "number") caps["FluencyScore"] = true;
        if (typeof pa.ProsodyScore === "number") caps["ProsodyScore"] = true;
        if (typeof pa.CompletenessScore === "number") caps["CompletenessScore"] = true;
        if (typeof pa.PronScore === "number") caps["PronScore"] = true;
      }
      for (const word of nb.Words ?? []) {
        const wpa = word.PronunciationAssessment;
        if (wpa) {
          if (wpa.AccuracyScore !== undefined) caps["word.AccuracyScore"] = true;
          if (wpa.ErrorType !== undefined) {
            caps["word.ErrorType"] = true;
            caps[`ErrorType=${wpa.ErrorType}`] = true;
          }
          if (wpa.Feedback?.Prosody?.Break !== undefined) {
            caps["word.Feedback.Prosody.Break"] = true;
          }
          if (wpa.Feedback?.Prosody?.Intonation !== undefined) {
            caps["word.Feedback.Prosody.Intonation"] = true;
          }
        }
        if (word.Syllables !== undefined) {
          caps["word.Syllables"] = true;
        }
        if (word.Phonemes !== undefined) {
          caps["word.Phonemes"] = true;
          for (const phoneme of word.Phonemes) {
            if (phoneme.PronunciationAssessment?.NBestPhonemes !== undefined) {
              caps["phoneme.NBestPhonemes"] = true;
            }
          }
        }
      }
    }
  }

  return caps;
}

export function catalogCoverage(
  mismatches: Mismatch[],
): { code: string; count: number; inCatalog: boolean }[] {
  const counts = new Map<string, number>();
  for (const m of mismatches) {
    const pair = `${m.expected}>${m.heard}`;
    const code = AZURE_TO_CATALOG[pair] ?? pair;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  const results: { code: string; count: number; inCatalog: boolean }[] = [];
  for (const [code, count] of counts.entries()) {
    results.push({
      code,
      count,
      inCatalog: findPattern(code) !== undefined,
    });
  }

  return results.sort((a, b) => b.count - a.count);
}

export function resultLagMs(
  eventAtMs: number,
  pushStartMs: number,
  phrase: PhraseResult,
  speed: number,
): number {
  const phraseEndAudioMs = (phrase.Offset + phrase.Duration) / 10_000;
  const pushEndMs = pushStartMs + phraseEndAudioMs / speed;
  const lag = eventAtMs - pushEndMs;
  return Math.max(0, lag);
}

export type Mode = "unscripted" | "scripted";

export async function assess(
  pcm: Buffer,
  mode: Mode,
  referenceText: string,
  opts: { speed: number },
): Promise<{ phrases: PhraseResult[]; lagsMs: number[]; finishedAfterMs: number }> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    throw new Error("AZURE_SPEECH_KEY and AZURE_SPEECH_REGION must be set.");
  }

  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechRecognitionLanguage = "en-US";

  const pushStream = sdk.AudioInputStream.createPushStream(
    sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1),
  );
  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  const pronJson = JSON.stringify({
    referenceText: mode === "scripted" ? referenceText : "",
    gradingSystem: "HundredMark",
    granularity: "Phoneme",
    phonemeAlphabet: "IPA",
    nBestPhonemeCount: 5,
    enableMiscue: false,
  });
  const pronConfig = sdk.PronunciationAssessmentConfig.fromJSON(pronJson);
  pronConfig.enableProsodyAssessment = true;
  pronConfig.applyTo(recognizer);

  return new Promise((resolve, reject) => {
    const phrases: PhraseResult[] = [];
    const lagsMs: number[] = [];
    let pushStartMs = 0;
    let lastPushMs = 0;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let settled = false;

    const cleanup = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    recognizer.recognized = (_sender, event) => {
      if (event.result.reason === sdk.ResultReason.RecognizedSpeech) {
        const eventAtMs = performance.now();
        const jsonStr = event.result.properties.getProperty(
          sdk.PropertyId.SpeechServiceResponse_JsonResult,
        );
        if (jsonStr) {
          try {
            const phrase = JSON.parse(jsonStr) as PhraseResult;
            phrases.push(phrase);
            lagsMs.push(resultLagMs(eventAtMs, pushStartMs, phrase, opts.speed));
          } catch {
            // ignore JSON parse error on malformed phrase
          }
        }
      }
    };

    recognizer.canceled = (_sender, event) => {
      if (event.reason === sdk.CancellationReason.Error) {
        if (!settled) {
          settled = true;
          cleanup();
          try {
            recognizer.close();
          } catch {}
          reject(new Error(`Azure recognition canceled with error: ${event.errorDetails}`));
        }
      }
    };

    recognizer.sessionStopped = async () => {
      if (settled) return;
      settled = true;
      const finishedAfterMs = performance.now() - lastPushMs;
      cleanup();

      try {
        await new Promise<void>((res, rej) =>
          recognizer.stopContinuousRecognitionAsync(res, (err) => rej(new Error(err))),
        );
      } catch {}
      try {
        recognizer.close();
      } catch {}

      resolve({ phrases, lagsMs, finishedAfterMs });
    };

    recognizer.startContinuousRecognitionAsync(
      async () => {
        try {
          pushStartMs = performance.now();
          const chunkSize = 3200; // 100 ms of 16kHz 16-bit mono PCM
          const delayMs = 100 / opts.speed;

          for (let offset = 0; offset < pcm.length; offset += chunkSize) {
            const end = Math.min(offset + chunkSize, pcm.length);
            const slice = pcm.subarray(offset, end);
            const ab = new ArrayBuffer(slice.length);
            new Uint8Array(ab).set(slice);
            pushStream.write(ab);
            if (offset + chunkSize < pcm.length) {
              await new Promise((r) => setTimeout(r, delayMs));
            }
          }

          pushStream.close();
          lastPushMs = performance.now();

          timeoutTimer = setTimeout(() => {
            if (!settled) {
              settled = true;
              try {
                recognizer.stopContinuousRecognitionAsync(
                  () => {},
                  () => {},
                );
                recognizer.close();
              } catch {}
              reject(
                new Error(
                  "Azure continuous recognition timed out waiting 30 s for sessionStopped.",
                ),
              );
            }
          }, 30_000);
        } catch (err) {
          if (!settled) {
            settled = true;
            cleanup();
            try {
              recognizer.close();
            } catch {}
            reject(err);
          }
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          cleanup();
          try {
            recognizer.close();
          } catch {}
          reject(new Error(`Failed to start continuous recognition: ${err}`));
        }
      },
    );
  });
}

export async function synthesizeBaseline(key: string, region: string): Promise<void> {
  const clipsDir = resolve("out", "azure-pron", "clips");
  mkdirSync(clipsDir, { recursive: true });

  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const escapeXml = (str: string) =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const ssml = `<speak version='1.0' xml:lang='en-US'><voice xml:lang='en-US' name='en-US-AvaMultilingualNeural'>${escapeXml(READING_PARAGRAPH)}</voice></speak>`;

  console.log(`Synthesizing baseline clip via Azure TTS (${region})...`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "raw-16khz-16bit-mono-pcm",
      "User-Agent": "fluency-azure-check",
    },
    body: ssml,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Azure TTS request failed (${response.status}): ${errorText}`);
  }

  const pcm = Buffer.from(await response.arrayBuffer());
  const wav = pcmToWav(pcm, 16000);

  const wavPath = resolve(clipsDir, "synthetic-baseline.wav");
  const txtPath = resolve(clipsDir, "synthetic-baseline.txt");
  writeFileSync(wavPath, wav);
  writeFileSync(txtPath, READING_PARAGRAPH, "utf-8");
  console.log(`Wrote baseline files to:\n  ${wavPath}\n  ${txtPath}`);
}

export function computeWeightedScores(phrases: PhraseResult[]): Record<string, number> {
  const scoreKeys = [
    "AccuracyScore",
    "FluencyScore",
    "ProsodyScore",
    "CompletenessScore",
    "PronScore",
  ];
  const totals: Record<string, { weightedSum: number; totalDuration: number }> = {};
  for (const key of scoreKeys) {
    totals[key] = { weightedSum: 0, totalDuration: 0 };
  }

  for (const phrase of phrases) {
    const assessment = phrase.NBest?.[0]?.PronunciationAssessment;
    const dur = phrase.Duration ?? 0;
    if (!assessment || dur <= 0) continue;
    for (const key of scoreKeys) {
      const val = assessment[key];
      if (typeof val === "number") {
        totals[key].weightedSum += val * dur;
        totals[key].totalDuration += dur;
      }
    }
  }

  const result: Record<string, number> = {};
  for (const key of scoreKeys) {
    const { weightedSum, totalDuration } = totals[key];
    if (totalDuration > 0) {
      result[key] = Math.round((weightedSum / totalDuration) * 10) / 10;
    }
  }
  return result;
}

export function formatCapabilitiesTable(
  unscriptedCaps: Record<string, boolean>,
  scriptedCaps: Record<string, boolean>,
): string {
  const baseKeys = [
    "AccuracyScore",
    "FluencyScore",
    "ProsodyScore",
    "CompletenessScore",
    "PronScore",
    "word.AccuracyScore",
    "word.ErrorType",
    "word.Feedback.Prosody.Break",
    "word.Feedback.Prosody.Intonation",
    "word.Syllables",
    "word.Phonemes",
    "phoneme.NBestPhonemes",
  ];
  const allKeys = Array.from(
    new Set([...baseKeys, ...Object.keys(unscriptedCaps), ...Object.keys(scriptedCaps)]),
  );

  const headers = ["Capability", "Unscripted", "Scripted"];
  const rows = allKeys.map((k) => [k, unscriptedCaps[k] ? "✓" : "–", scriptedCaps[k] ? "✓" : "–"]);

  const colWidths = headers.map((header, colIndex) => {
    let max = header.length;
    for (const row of rows) {
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
  for (const row of rows) {
    lines.push(formatLine(row));
  }
  return lines.join("\n");
}

export function formatCoverageTable(
  coverage: { code: string; count: number; inCatalog: boolean }[],
): string {
  if (coverage.length === 0) return "No phoneme mismatches detected.";
  const headers = ["Pattern / Pair", "Count", "In Catalog"];
  const rows = coverage.map((c) => [c.code, String(c.count), c.inCatalog ? "✓" : "–"]);

  const colWidths = headers.map((header, colIndex) => {
    let max = header.length;
    for (const row of rows) {
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
  for (const row of rows) {
    lines.push(formatLine(row));
  }
  return lines.join("\n");
}

export function parseArgs(argv: string[]): { synth: boolean; fast: boolean; clips: string[] } {
  let synth = false;
  let fast = false;
  const clips: string[] = [];
  for (const arg of argv) {
    if (arg === "--synth") {
      synth = true;
    } else if (arg === "--fast") {
      fast = true;
    } else if (!arg.startsWith("--")) {
      clips.push(arg);
    }
  }
  return { synth, fast, clips };
}

async function main(): Promise<void> {
  const { synth, fast, clips } = parseArgs(process.argv.slice(2));

  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;

  if (!key || !region) {
    console.error("Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION in environment.");
    process.exitCode = 2;
    return;
  }

  if (synth) {
    try {
      await synthesizeBaseline(key, region);
    } catch (err) {
      console.error("Synthesis failed:", err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
    }
    return;
  }

  const clipsDir = resolve("out", "azure-pron", "clips");
  let targetClips: string[] = [];
  if (clips.length > 0) {
    targetClips = clips.map((c) => resolve(c));
  } else if (existsSync(clipsDir)) {
    targetClips = readdirSync(clipsDir)
      .filter((f) => f.endsWith(".wav"))
      .sort()
      .map((f) => resolve(clipsDir, f));
  }

  if (targetClips.length === 0) {
    console.error(
      "No WAV clips found to assess. Provide paths or place .wav files in out/azure-pron/clips/",
    );
    process.exitCode = 2;
    return;
  }

  const speed = fast ? 4 : 1;
  const resultsDir = resolve("out", "azure-pron", "results");
  mkdirSync(resultsDir, { recursive: true });

  let successfulClips = 0;
  const allUnscriptedPhrases: PhraseResult[] = [];
  const allScriptedPhrases: PhraseResult[] = [];

  for (const clipPath of targetClips) {
    const clipName = parse(clipPath).name;
    console.log(`\n========================================`);
    console.log(`Assessing clip: ${basename(clipPath)}`);
    console.log(`========================================`);

    let pcm: Buffer;
    let sampleRate: number;
    try {
      const buf = readFileSync(clipPath);
      const wav = parseWav(buf);
      pcm = wav.pcm;
      sampleRate = wav.sampleRate;
    } catch (err) {
      console.error(
        `Failed to read/parse ${clipPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const durationMs = (pcm.length / 2 / sampleRate) * 1000;
    console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s (${Math.round(durationMs)}ms)`);

    const sidecarPath = clipPath.replace(/\.wav$/i, ".txt");
    const hasSidecar = existsSync(sidecarPath);
    const sidecarText = hasSidecar ? readFileSync(sidecarPath, "utf-8").trim() : undefined;

    try {
      // 1. Unscripted
      console.log(`\n[${basename(clipPath)}] Mode: unscripted`);
      const unscriptedRes = await assess(pcm, "unscripted", "", { speed });
      allUnscriptedPhrases.push(...unscriptedRes.phrases);

      const unscriptedText = unscriptedRes.phrases.map((p) => p.DisplayText).join(" ");
      const unscriptedGate = gateCheck(durationMs, unscriptedText);
      console.log(
        `Gate check: ${unscriptedGate.ok ? "PASS" : "FAIL"} (${unscriptedGate.seconds}s, ${unscriptedGate.words} words, ${unscriptedGate.sentences} sentences)`,
      );

      const unscriptedScores = computeWeightedScores(unscriptedRes.phrases);
      const uScoresStr = Object.entries(unscriptedScores)
        .map(([k, v]) => `${k}=${v.toFixed(1)}`)
        .join(", ");
      console.log(`Scores (duration-weighted): ${uScoresStr || "none"}`);

      if (unscriptedRes.lagsMs.length > 0) {
        const p50 = percentile(unscriptedRes.lagsMs, 50);
        const maxLag = Math.max(...unscriptedRes.lagsMs);
        console.log(
          `Phrases: ${unscriptedRes.phrases.length}, Lag p50: ${Math.round(p50)}ms, Lag max: ${Math.round(maxLag)}ms`,
        );
      } else {
        console.log(`Phrases: ${unscriptedRes.phrases.length}, Lag: N/A`);
      }
      console.log(`Finished after: ${Math.round(unscriptedRes.finishedAfterMs)}ms`);

      const uWeak = weakWords(unscriptedRes.phrases, 60).slice(0, 10);
      if (uWeak.length > 0) {
        console.log(
          `Weak words (<60): ${uWeak.map((w) => `${w.word} (${Math.round(w.score)}${w.errorType ? `, ${w.errorType}` : ""})`).join(", ")}`,
        );
      } else {
        console.log("Weak words (<60): none");
      }

      writeFileSync(
        resolve(resultsDir, `${clipName}.unscripted.json`),
        JSON.stringify(
          {
            clip: clipName,
            mode: "unscripted",
            referenceText: "",
            phrases: unscriptedRes.phrases,
            lagsMs: unscriptedRes.lagsMs,
          },
          null,
          2,
        ),
      );

      // 2. Scripted
      let referenceText = "";
      let refSource = "";
      if (sidecarText !== undefined) {
        referenceText = sidecarText;
        refSource = `sidecar (${basename(sidecarPath)})`;
      } else {
        referenceText = unscriptedText;
        refSource = "unscripted DisplayText";
      }

      console.log(`\n[${basename(clipPath)}] Mode: scripted`);
      console.log(`Reference text source: ${refSource}`);
      console.log(`Reference text: "${referenceText}"`);

      const scriptedRes = await assess(pcm, "scripted", referenceText, { speed });
      allScriptedPhrases.push(...scriptedRes.phrases);

      const scriptedGate = gateCheck(durationMs, referenceText);
      console.log(
        `Gate check: ${scriptedGate.ok ? "PASS" : "FAIL"} (${scriptedGate.seconds}s, ${scriptedGate.words} words, ${scriptedGate.sentences} sentences)`,
      );

      const scriptedScores = computeWeightedScores(scriptedRes.phrases);
      const sScoresStr = Object.entries(scriptedScores)
        .map(([k, v]) => `${k}=${v.toFixed(1)}`)
        .join(", ");
      console.log(`Scores (duration-weighted): ${sScoresStr || "none"}`);

      if (scriptedRes.lagsMs.length > 0) {
        const p50 = percentile(scriptedRes.lagsMs, 50);
        const maxLag = Math.max(...scriptedRes.lagsMs);
        console.log(
          `Phrases: ${scriptedRes.phrases.length}, Lag p50: ${Math.round(p50)}ms, Lag max: ${Math.round(maxLag)}ms`,
        );
      } else {
        console.log(`Phrases: ${scriptedRes.phrases.length}, Lag: N/A`);
      }
      console.log(`Finished after: ${Math.round(scriptedRes.finishedAfterMs)}ms`);

      const sWeak = weakWords(scriptedRes.phrases, 60).slice(0, 10);
      if (sWeak.length > 0) {
        console.log(
          `Weak words (<60): ${sWeak.map((w) => `${w.word} (${Math.round(w.score)}${w.errorType ? `, ${w.errorType}` : ""})`).join(", ")}`,
        );
      } else {
        console.log("Weak words (<60): none");
      }

      if (hasSidecar) {
        console.log("\nTranscript comparison:");
        console.log(`  Sidecar (true):      ${sidecarText}`);
        console.log(`  Azure (unscripted):  ${unscriptedText}`);
      }

      writeFileSync(
        resolve(resultsDir, `${clipName}.scripted.json`),
        JSON.stringify(
          {
            clip: clipName,
            mode: "scripted",
            referenceText,
            phrases: scriptedRes.phrases,
            lagsMs: scriptedRes.lagsMs,
          },
          null,
          2,
        ),
      );

      successfulClips++;
    } catch (err) {
      console.error(
        `Error assessing clip ${clipPath}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  if (allUnscriptedPhrases.length > 0 || allScriptedPhrases.length > 0) {
    const unscriptedCaps = capabilities(allUnscriptedPhrases);
    const scriptedCaps = capabilities(allScriptedPhrases);
    console.log("\n========================================");
    console.log("Capabilities Matrix");
    console.log("========================================");
    console.log(formatCapabilitiesTable(unscriptedCaps, scriptedCaps));

    const allMismatches = [
      ...phonemeMismatches(allUnscriptedPhrases),
      ...phonemeMismatches(allScriptedPhrases),
    ];
    const coverage = catalogCoverage(allMismatches);
    console.log("\n========================================");
    console.log("Catalog Coverage (Mismatches)");
    console.log("========================================");
    console.log(formatCoverageTable(coverage));

    const coveredCodes = new Set(Object.values(AZURE_TO_CATALOG));
    const notDetectable = BN_EN_PRONUNCIATION_PATTERNS.filter((p) => !coveredCodes.has(p.code)).map(
      (p) => `  - ${p.code} (not detectable from phonemes)`,
    );
    console.log("\n========================================");
    console.log("Catalog Patterns Not Detectable from Phonemes");
    console.log("========================================");
    if (notDetectable.length > 0) {
      console.log(notDetectable.join("\n"));
    } else {
      console.log("None");
    }
  }

  if (successfulClips === 0) {
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
