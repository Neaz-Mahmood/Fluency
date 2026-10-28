import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CLAUDE_MODELS, OPENCODE_BASE_URL, streamClaudeReply } from "../../lib/anthropic.ts";
import {
  buildFeedbackInput,
  buildFeedbackSystemPrompt,
  parseFeedback,
} from "../../lib/feedback.ts";
import { resolveProvider } from "../../lib/provider.ts";

export type Edit = { original: string; correction: string };

export type GoldenItem = {
  id: string;
  input: string;
  expected_edits: Edit[];
  is_error_free: boolean;
};

export type Corrector = (inputs: string[]) => Promise<Edit[][]>;

export type Generate = (system: string, input: string) => Promise<string>;

// Fewer, larger calls are cheaper.
export const BATCH_SIZE = 20;
// A small pool stays under provider rate limits.
export const MAX_CONCURRENT_BATCHES = 3;

export type ScoreResult = {
  total: number;
  errorFree: number;
  overCorrected: number;
  overCorrectionRate: number;
  expectedEdits: number;
  predictedEdits: number;
  matchedEdits: number;
  precision: number;
  recall: number;
  f05: number;
};

export type Baseline = {
  model: string;
  measuredAt: string; // YYYY-MM-DD
  sentences: number;
  errorFree: number;
  overCorrected: number;
  overCorrectionRate: number;
  precision: number;
  recall: number;
  f05: number;
};

export const OVER_CORRECTION_LIMIT = 0.05; // doc/roadmap.md Phase 3 exit gate; blocks release.
// The model isn't deterministic; one extra over-corrected sentence is noise, not a regression.
export const OVER_CORRECTION_NOISE_SENTENCES = 1;

export function parseGoldenSet(raw: unknown): GoldenItem[] {
  if (!Array.isArray(raw)) {
    throw new Error("Golden set must be an array.");
  }

  const seenIds = new Set<string>();
  const items: GoldenItem[] = [];

  for (let index = 0; index < raw.length; index++) {
    const item = raw[index];
    if (!item || typeof item !== "object") {
      throw new Error(`Golden item ${index}: item must be an object.`);
    }

    const record = item as Record<string, unknown>;

    if (typeof record.id !== "string" || record.id.trim() === "") {
      throw new Error(`Golden item ${index}: id must be a string.`);
    }
    if (seenIds.has(record.id)) {
      throw new Error(`Golden item ${index}: duplicate id "${record.id}".`);
    }
    seenIds.add(record.id);

    if (typeof record.input !== "string") {
      throw new Error(`Golden item ${index}: input must be a string.`);
    }

    if (!Array.isArray(record.expected_edits)) {
      throw new Error(`Golden item ${index}: expected_edits must be an array.`);
    }

    const expected_edits: Edit[] = [];
    for (const edit of record.expected_edits) {
      if (
        !edit ||
        typeof edit !== "object" ||
        typeof (edit as Record<string, unknown>).original !== "string" ||
        typeof (edit as Record<string, unknown>).correction !== "string"
      ) {
        throw new Error(
          `Golden item ${index}: each edit must have original and correction strings.`,
        );
      }
      expected_edits.push({
        original: (edit as Record<string, unknown>).original as string,
        correction: (edit as Record<string, unknown>).correction as string,
      });
    }

    if (typeof record.is_error_free !== "boolean") {
      throw new Error(`Golden item ${index}: is_error_free must be a boolean.`);
    }

    if (record.is_error_free !== (expected_edits.length === 0)) {
      throw new Error(
        `Golden item ${index}: is_error_free must match expected_edits length (${expected_edits.length}).`,
      );
    }

    items.push({
      id: record.id,
      input: record.input,
      expected_edits,
      is_error_free: record.is_error_free,
    });
  }

  return items;
}

export const noEdits: Corrector = async (inputs) => inputs.map(() => []);

export function createModelCorrector(generate: Generate): Corrector {
  return async (inputs: string[]): Promise<Edit[][]> => {
    if (inputs.length === 0) {
      return [];
    }

    const batches: string[][] = [];
    for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
      batches.push(inputs.slice(i, i + BATCH_SIZE));
    }

    const results: Edit[][][] = new Array(batches.length);
    let nextBatchIndex = 0;

    async function worker(): Promise<void> {
      while (nextBatchIndex < batches.length) {
        const batchIndex = nextBatchIndex++;
        const batch = batches[batchIndex];
        const n = batchIndex + 1;

        const { input, learnerLines } = buildFeedbackInput(
          batch.map((content) => ({ role: "user", content, inputMode: "typed" })),
        );

        const text = await generate(buildFeedbackSystemPrompt("English"), input);
        const feedback = parseFeedback(text, learnerLines);
        if (feedback === null) {
          throw new Error(`Could not parse the corrector's output for batch ${n}.`);
        }

        const itemsByLine = new Map<number, Edit[]>();
        for (const item of feedback.items) {
          itemsByLine.set(
            item.line,
            item.edits.map(({ original, correction }) => ({ original, correction })),
          );
        }

        const batchEdits: Edit[][] = batch.map((_, index) => {
          const lineNumber = index + 1;
          return itemsByLine.get(lineNumber) ?? [];
        });

        results[batchIndex] = batchEdits;
      }
    }

    const workerCount = Math.min(MAX_CONCURRENT_BATCHES, batches.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);

    return results.flat();
  };
}

export function claudeGenerate(selected: {
  provider: "claude" | "opencode";
  apiKey: string;
}): Generate {
  return async (system: string, input: string): Promise<string> => {
    const reply = streamClaudeReply({
      apiKey: selected.apiKey,
      baseURL: selected.provider === "opencode" ? OPENCODE_BASE_URL : undefined,
      system,
      messages: [{ role: "user", content: input }],
      model: "feedback",
      label: "eval",
      // The feedback model's thinking counts toward it, and a 20-sentence batch can return many items.
      maxTokens: 8000,
    });

    let text = "";
    for await (const chunk of reply.text) {
      text += chunk;
    }
    return text.trim();
  };
}

export function normalizeEdit(
  input: string,
  edit: Edit,
): { start: number; end: number; text: string } | null {
  const index = input.indexOf(edit.original);
  if (index === -1) {
    return null;
  }

  let a = edit.original;
  let b = edit.correction;
  let start = index;

  while (a.length > 0 && b.length > 0) {
    const matchA = a.match(/^(\S+)(\s*)/);
    const matchB = b.match(/^(\S+)(\s*)/);
    if (!matchA || !matchB || matchA[1] !== matchB[1]) {
      break;
    }
    let removedFromA = matchA[0].length;
    if (matchA[2].length < matchB[2].length) {
      const extraNeeded = matchB[2].length - matchA[2].length;
      const inputSpaces = input.slice(start + removedFromA).match(/^\s*/)?.[0].length ?? 0;
      const consumed = Math.min(extraNeeded, inputSpaces);
      removedFromA += consumed;
    }
    start += removedFromA;
    a = a.slice(matchA[0].length);
    b = b.slice(matchB[0].length);
  }

  while (a.length > 0 && b.length > 0) {
    const matchA = a.match(/(\s*)(\S+)$/);
    const matchB = b.match(/(\s*)(\S+)$/);
    if (!matchA || !matchB || matchA[2] !== matchB[2]) {
      break;
    }
    a = a.slice(0, a.length - matchA[0].length);
    b = b.slice(0, b.length - matchB[0].length);
  }

  if (a === b) {
    return null;
  }

  return { start, end: start + a.length, text: b };
}

export function score(items: GoldenItem[], predictions: Edit[][]): ScoreResult {
  const total = items.length;
  let errorFree = 0;
  let overCorrected = 0;
  let expectedEdits = 0;
  let predictedEdits = 0;
  let matchedEdits = 0;

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const preds = predictions[index] ?? [];

    expectedEdits += item.expected_edits.length;
    predictedEdits += preds.length;

    if (item.is_error_free) {
      errorFree++;
      if (preds.length >= 1) {
        overCorrected++;
      }
    }

    const remainingExpected = item.expected_edits
      .map((exp) => normalizeEdit(item.input, exp))
      .filter((span): span is NonNullable<typeof span> => span !== null);

    for (const pred of preds) {
      const predSpan = normalizeEdit(item.input, pred);
      if (!predSpan) {
        continue;
      }
      const matchIndex = remainingExpected.findIndex(
        (exp) =>
          exp.start === predSpan.start && exp.end === predSpan.end && exp.text === predSpan.text,
      );
      if (matchIndex !== -1) {
        matchedEdits++;
        remainingExpected.splice(matchIndex, 1);
      }
    }
  }

  const overCorrectionRate = errorFree === 0 ? 0 : overCorrected / errorFree;
  const precision = predictedEdits === 0 ? 0 : matchedEdits / predictedEdits;
  const recall = expectedEdits === 0 ? 0 : matchedEdits / expectedEdits;
  const f05 =
    precision + recall === 0 ? 0 : (1.25 * precision * recall) / (0.25 * precision + recall);

  return {
    total,
    errorFree,
    overCorrected,
    overCorrectionRate,
    expectedEdits,
    predictedEdits,
    matchedEdits,
    precision,
    recall,
    f05,
  };
}

export function formatReport(result: ScoreResult): string {
  const pct = (result.overCorrectionRate * 100).toFixed(1);
  return [
    `Sentences: ${result.total} (${result.errorFree} error-free)`,
    `Over-correction: ${result.overCorrected}/${result.errorFree} (${pct}%)`,
    `Edits: expected ${result.expectedEdits}, predicted ${result.predictedEdits}, matched ${result.matchedEdits}`,
    `Edit F0.5: ${result.f05.toFixed(3)} (precision ${result.precision.toFixed(3)}, recall ${result.recall.toFixed(3)}; normalized span match, not ERRANT)`,
  ].join("\n");
}

export function parseBaseline(raw: unknown): Baseline | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.model !== "string" || record.model.trim() === "") {
    return null;
  }
  if (typeof record.measuredAt !== "string" || record.measuredAt.trim() === "") {
    return null;
  }
  const numericFields = [
    "sentences",
    "errorFree",
    "overCorrected",
    "overCorrectionRate",
    "precision",
    "recall",
    "f05",
  ] as const;
  for (const field of numericFields) {
    if (typeof record[field] !== "number" || !Number.isFinite(record[field])) {
      return null;
    }
  }
  return {
    model: record.model,
    measuredAt: record.measuredAt,
    sentences: record.sentences as number,
    errorFree: record.errorFree as number,
    overCorrected: record.overCorrected as number,
    overCorrectionRate: record.overCorrectionRate as number,
    precision: record.precision as number,
    recall: record.recall as number,
    f05: record.f05 as number,
  };
}

export function checkGate(result: ScoreResult, baseline: Baseline | null): string[] {
  const failures: string[] = [];
  if (result.overCorrectionRate >= OVER_CORRECTION_LIMIT) {
    const pct = (result.overCorrectionRate * 100).toFixed(1);
    failures.push(`Over-correction ${pct}% is at or above the 5% limit.`);
  }
  if (
    baseline !== null &&
    result.overCorrected > baseline.overCorrected + OVER_CORRECTION_NOISE_SENTENCES
  ) {
    failures.push(
      `Over-correction rose from ${baseline.overCorrected} to ${result.overCorrected} error-free sentences.`,
    );
  }
  return failures;
}

async function main(): Promise<void> {
  const noModel = process.argv.includes("--no-model");
  const writeBaseline = process.argv.includes("--write-baseline");

  let corrector: Corrector;
  if (noModel) {
    corrector = noEdits;
  } else {
    const selection = resolveProvider(process.env);
    if ("error" in selection) {
      console.error(`Eval needs an AI provider: ${selection.error}`);
      process.exitCode = 2;
      return;
    }
    if (selection.provider === "google") {
      console.error("Eval runs the Claude feedback model; set AI_PROVIDER to claude or opencode.");
      process.exitCode = 2;
      return;
    }
    corrector = createModelCorrector(
      claudeGenerate({ provider: selection.provider, apiKey: selection.apiKey }),
    );
  }

  const goldenPath = fileURLToPath(new URL("./golden/bn-en.json", import.meta.url));
  const raw = JSON.parse(readFileSync(goldenPath, "utf-8")) as unknown;
  const items = parseGoldenSet(raw);
  const predictions = await corrector(items.map((item) => item.input));
  const result = score(items, predictions);
  console.log(formatReport(result));

  const baselinePath = fileURLToPath(new URL("./baseline.json", import.meta.url));
  let baseline: Baseline | null = null;
  if (existsSync(baselinePath)) {
    try {
      const rawBaseline = JSON.parse(readFileSync(baselinePath, "utf-8")) as unknown;
      baseline = parseBaseline(rawBaseline);
    } catch {
      baseline = null;
    }
  }

  const failures = noModel ? [] : checkGate(result, baseline);
  for (const failure of failures) {
    console.error(`FAIL: ${failure}`);
  }
  if (failures.length > 0) {
    process.exitCode = 1;
    return;
  }

  if (writeBaseline) {
    const newBaseline: Baseline = {
      model: CLAUDE_MODELS.feedback,
      measuredAt: new Date().toISOString().slice(0, 10),
      sentences: result.total,
      errorFree: result.errorFree,
      overCorrected: result.overCorrected,
      overCorrectionRate: result.overCorrectionRate,
      precision: result.precision,
      recall: result.recall,
      f05: result.f05,
    };
    writeFileSync(baselinePath, JSON.stringify(newBaseline, null, 2) + "\n");
    console.log("Baseline written.");
  }
}

if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    resolve(process.argv[1]) === fileURLToPath(import.meta.url))
) {
  await main();
}
