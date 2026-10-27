import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { and, eq, gte, isNotNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { sessions, sessionTurns } from "@/lib/db/schema";
import { isUuid } from "@/lib/learner-id";
import { percentile } from "./ttft.ts";

// Set 2026-10-27 (FLU-75). The original 750 / 950 ms can't be met by this pipeline from Dhaka: the
// floor without the model and TTS is about 800 ms (doc/voice-path.md, Decision 2).
export const GATE_P50_MS = 1600;
export const GATE_P90_MS = 2200;
// Fewer turns than this are too few to call the gate.
export const MIN_GATE_TURNS = 20;

export type LatencySummary = { n: number; p50: number; p90: number; min: number; max: number };

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export function summarizeLatency(values: number[]): LatencySummary | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    p50: Math.round(percentile(values, 50)),
    p90: Math.round(percentile(values, 90)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

export function gateVerdict(summary: LatencySummary): "pass" | "fail" | "too few turns" {
  if (summary.n < MIN_GATE_TURNS) {
    return "too few turns";
  }
  if (summary.p50 < GATE_P50_MS && summary.p90 < GATE_P90_MS) {
    return "pass";
  }
  return "fail";
}

export function parseLatencyArgs(
  argv: string[],
): { since: string | null; learnerId: string | null } | { error: string } {
  let since: string | null = null;
  let learnerId: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--since") {
      i++;
      if (i >= argv.length) {
        return { error: "Missing value for --since." };
      }
      since = argv[i];
    } else if (arg.startsWith("--since=")) {
      since = arg.slice("--since=".length);
    } else if (arg === "--learner") {
      i++;
      if (i >= argv.length) {
        return { error: "Missing value for --learner." };
      }
      learnerId = argv[i];
    } else if (arg.startsWith("--learner=")) {
      learnerId = arg.slice("--learner=".length);
    } else {
      return { error: `Unknown argument: ${arg}` };
    }
  }

  if (since !== null) {
    // The round trip rejects dates that don't exist, such as 2026-02-30.
    const date = new Date(`${since}T00:00:00.000Z`);
    if (
      !DATE_FORMAT.test(since) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== since
    ) {
      return { error: `Invalid date for --since: "${since}". Expected YYYY-MM-DD.` };
    }
  }

  if (learnerId !== null && !isUuid(learnerId)) {
    return { error: `Invalid UUID for --learner: "${learnerId}".` };
  }

  return { since, learnerId };
}

export async function main(): Promise<void> {
  const parsed = parseLatencyArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(1);
  }

  const db = getDb();
  try {
    const conditions = [isNotNull(sessionTurns.speechEndToAudioMs)];
    if (parsed.since) {
      const sinceDate = new Date(`${parsed.since}T00:00:00.000Z`);
      conditions.push(gte(sessionTurns.createdAt, sinceDate));
    }
    if (parsed.learnerId) {
      conditions.push(eq(sessions.learnerId, parsed.learnerId));
    }

    const rows = await db
      .select({ speechEndToAudioMs: sessionTurns.speechEndToAudioMs })
      .from(sessionTurns)
      .innerJoin(sessions, eq(sessionTurns.sessionId, sessions.sessionId))
      .where(and(...conditions));

    const values = rows.map((r) => r.speechEndToAudioMs).filter((v): v is number => v !== null);

    const summary = summarizeLatency(values);
    if (!summary) {
      console.log("No live voice latency measured yet.");
      return;
    }

    const verdict = gateVerdict(summary);
    console.log("Live voice latency, speech end → first reply audio (browser)");
    console.log(
      `turns ${summary.n} · p50 ${summary.p50} ms · p90 ${summary.p90} ms · min ${summary.min} ms · max ${summary.max} ms`,
    );
    console.log(`gate p50 < ${GATE_P50_MS} ms, p90 < ${GATE_P90_MS} ms: ${verdict}`);
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
