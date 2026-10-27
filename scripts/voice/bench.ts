import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { chromium } from "playwright-core";

import { getDb } from "@/lib/db";
import { learnerProfiles, sessions, sessionTurns, voiceUsage } from "@/lib/db/schema";
import { LEARNER_COOKIE } from "@/lib/learner-id";
import { quotaDay } from "@/lib/voice-quota";
import { GATE_P50_MS, GATE_P90_MS, gateVerdict, summarizeLatency } from "./latency.ts";

// Live voice latency bench (FLU-72): headless Chrome plays a WAV as the microphone in a live
// voice session, once per bench learner, and the browser times each reply as it does for real
// learners. The app at --url and this script must use the same database as the worker, because
// the browser's numbers are saved on the turns the worker writes.

export const BENCH_USER_PREFIX = "voice-bench-";
export const DEFAULT_WAV = "out/flu63/fake-mic.wav";
// Time after the WAV ends for the last reply to finish.
const TAIL_SECONDS = 15;
// LiveKit Cloud's Build plan allows 5 concurrent sessions; runs are sequential anyway.
const MAX_LEARNERS = 5;

// Runs in the page before the app (FLU-74). It polls the receiving peer connection's audio stats
// every 10 ms and logs, in wall-clock ms, when the agent's decoded audio level rises after a
// silence. With the worker's timeline and the browser's "audible at" time, that splits the
// downlink into transport (worker → decoded) and the Web Audio path to the latency analyser.
export const LEVEL_PROBE = `(() => {
  const pcs = [];
  const Native = window.RTCPeerConnection;
  window.RTCPeerConnection = function (...args) {
    const pc = new Native(...args);
    pcs.push(pc);
    return pc;
  };
  window.RTCPeerConnection.prototype = Native.prototype;
  // audioLevel is linear (1 = full scale); 0.01 is -40 dBov. A reply starts when it rises above
  // that after at least 200 ms below.
  const LEVEL = 0.01, QUIET_MS = 200;
  let quietSince = null, busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const pc of pcs) {
        if (pc.connectionState === "closed") continue;
        for (const s of (await pc.getStats()).values()) {
          if (s.type !== "inbound-rtp" || s.kind !== "audio") continue;
          const now = Date.now();
          if ((s.audioLevel ?? 0) < LEVEL) quietSince ??= now;
          else if (quietSince !== null) {
            if (now - quietSince >= QUIET_MS) console.info("[voice] bench: agent level at " + now);
            quietSince = null;
          }
        }
      }
    } finally {
      busy = false;
    }
  }, 10);
})();`;

export type BenchArgs = { url: string; learners: number; wav: string };

export function parseBenchArgs(argv: string[]): BenchArgs | { error: string } {
  const args: BenchArgs = { url: "http://localhost:3000", learners: 3, wav: DEFAULT_WAV };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=", 2);
    const value = inline ?? argv[++i];
    if (value === undefined) return { error: `Missing value for ${flag}.` };
    if (flag === "--url") {
      args.url = value.replace(/\/$/, "");
    } else if (flag === "--learners") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > MAX_LEARNERS) {
        return { error: `--learners must be 1–${MAX_LEARNERS}.` };
      }
      args.learners = n;
    } else if (flag === "--wav") {
      args.wav = value;
    } else {
      return { error: `Unknown argument: ${flag}` };
    }
  }
  return args;
}

// Duration of a PCM WAV from its fmt and data chunks.
export function wavDurationSeconds(wav: Uint8Array): number {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file.");
  let byteRate = 0;
  for (let at = 12; at + 8 <= wav.byteLength;) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === "fmt ") byteRate = view.getUint32(at + 16, true);
    if (tag(at) === "data") {
      if (!byteRate) throw new Error("WAV data before its fmt chunk.");
      return size / byteRate;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk.");
}

// The numbers in the browser's "[voice] network: rtt 84 ms, jitter buffer 61 ms, …" lines.
export function parseNetworkLine(line: string): { rttMs: number | null; bufferMs: number | null } {
  const rtt = /rtt (\d+) ms/.exec(line);
  const buffer = /jitter buffer (\d+) ms/.exec(line);
  return { rttMs: rtt ? Number(rtt[1]) : null, bufferMs: buffer ? Number(buffer[1]) : null };
}

async function benchLearners(count: number): Promise<string[]> {
  const db = getDb();
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    const [row] = await db
      .insert(learnerProfiles)
      .values({
        userId: `${BENCH_USER_PREFIX}${i}`,
        nativeLanguage: "bn-BD",
        cefrSpeaking: "A2",
        voiceConsentAt: new Date(),
      })
      .onConflictDoUpdate({ target: learnerProfiles.userId, set: { voiceConsentAt: sql`now()` } })
      .returning({ learnerId: learnerProfiles.learnerId });
    ids.push(row.learnerId);
  }
  // Bench learners only: today's usage is cleared so repeated runs aren't refused by the quota.
  await db
    .delete(voiceUsage)
    .where(and(inArray(voiceUsage.learnerId, ids), eq(voiceUsage.day, quotaDay(new Date()))));
  return ids;
}

async function runSession(
  args: BenchArgs,
  learnerId: string,
  seconds: number,
  log: (line: string) => void,
): Promise<void> {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${resolve(args.wav)}%noloop`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  try {
    const context = await browser.newContext({ permissions: ["microphone"] });
    await context.addInitScript(LEVEL_PROBE);
    await context.addCookies([{ name: LEARNER_COOKIE, value: learnerId, url: args.url }]);
    const page = await context.newPage();
    page.on("console", (message) => {
      const text = message.text();
      if (text.includes("[voice]") || message.type() === "error") log(text);
    });
    page.on("pageerror", (error) => log(`pageerror: ${error.message}`));

    await page.goto(`${args.url}/practice`);
    await page
      .getByRole("button", { name: /ক্যাফেতে|café/i })
      .first()
      .click();
    await page.getByRole("button", { name: /Start live voice|লাইভ ভয়েস শুরু করুন/ }).click();
    await page.waitForTimeout(seconds * 1000);
    const stop = page.getByRole("button", { name: /End live voice|লাইভ ভয়েস বন্ধ করুন/ });
    if (await stop.isVisible()) await stop.click();
    // Gives the last measurement time to be saved.
    await page.waitForTimeout(2000);
  } finally {
    await browser.close();
  }
}

function percentiles(values: number[]): string {
  const summary = summarizeLatency(values);
  return summary ? `p50 ${summary.p50} ms · p90 ${summary.p90} ms (n ${summary.n})` : "n/a";
}

export async function main(): Promise<void> {
  const args = parseBenchArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error);
    process.exit(1);
  }
  const seconds = Math.ceil(wavDurationSeconds(readFileSync(args.wav)) + TAIL_SECONDS);

  const db = getDb();
  try {
    const learnerIds = await benchLearners(args.learners);
    const startedAt = new Date();
    const network: string[] = [];

    for (const [index, learnerId] of learnerIds.entries()) {
      console.log(`Session ${index + 1}/${learnerIds.length} (${seconds} s), ${learnerId}`);
      await runSession(args, learnerId, seconds, (line) => {
        console.log(`  ${line}`);
        if (line.startsWith("[voice] network:")) network.push(line);
      });
    }

    const rows = await db
      .select({ ms: sessionTurns.speechEndToAudioMs })
      .from(sessionTurns)
      .innerJoin(sessions, eq(sessionTurns.sessionId, sessions.sessionId))
      .where(
        and(
          inArray(sessions.learnerId, learnerIds),
          gte(sessionTurns.createdAt, startedAt),
          isNotNull(sessionTurns.speechEndToAudioMs),
        ),
      );
    const values = rows.map((row) => row.ms).filter((ms): ms is number => ms !== null);
    const summary = summarizeLatency(values);

    console.log("\nLive voice bench, speech end → first reply audio (browser, saved turns)");
    if (!summary) {
      console.log(
        "No turns saved. Check that the app at --url uses the same DATABASE_URL as this script and the worker.",
      );
      return;
    }
    console.log(
      `turns ${summary.n} · p50 ${summary.p50} ms · p90 ${summary.p90} ms · min ${summary.min} ms · max ${summary.max} ms`,
    );
    console.log(`gate p50 < ${GATE_P50_MS} ms, p90 < ${GATE_P90_MS} ms: ${gateVerdict(summary)}`);

    const parsed = network.map(parseNetworkLine);
    const rtts = parsed.map((p) => p.rttMs).filter((v): v is number => v !== null);
    const buffers = parsed.map((p) => p.bufferMs).filter((v): v is number => v !== null);
    console.log(`network rtt ${percentiles(rtts)} · jitter buffer ${percentiles(buffers)}`);
    console.log(
      `\nWorker side: lk agent logs | grep "timeline:" (since ${startedAt.toISOString()})`,
    );
  } finally {
    await db.$client.end();
  }
}

if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    resolve(process.argv[1]) === fileURLToPath(import.meta.url))
) {
  await main();
}
