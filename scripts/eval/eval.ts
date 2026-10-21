import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Edit = { original: string; correction: string };

export type GoldenItem = {
  id: string;
  input: string;
  expected_edits: Edit[];
  is_error_free: boolean;
};

export type Corrector = (input: string) => Promise<Edit[]>;

export type ScoreResult = {
  total: number;
  errorFree: number;
  overCorrected: number;
  overCorrectionRate: number;
  expectedEdits: number;
  predictedEdits: number;
  matchedEdits: number;
};

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

// Baseline until the Phase 3 correction prompt exists.
export const noEdits: Corrector = async () => [];

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

    const remainingExpected = [...item.expected_edits];
    for (const pred of preds) {
      const matchIndex = remainingExpected.findIndex(
        (exp) => exp.original === pred.original && exp.correction === pred.correction,
      );
      if (matchIndex !== -1) {
        matchedEdits++;
        remainingExpected.splice(matchIndex, 1);
      }
    }
  }

  const overCorrectionRate = errorFree === 0 ? 0 : overCorrected / errorFree;

  return {
    total,
    errorFree,
    overCorrected,
    overCorrectionRate,
    expectedEdits,
    predictedEdits,
    matchedEdits,
  };
}

export function formatReport(result: ScoreResult): string {
  const pct = (result.overCorrectionRate * 100).toFixed(1);
  return [
    `Sentences: ${result.total} (${result.errorFree} error-free)`,
    `Over-correction: ${result.overCorrected}/${result.errorFree} (${pct}%)`,
    `Edits: expected ${result.expectedEdits}, predicted ${result.predictedEdits}, matched ${result.matchedEdits}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const goldenPath = fileURLToPath(new URL("./golden/bn-en.json", import.meta.url));
  const raw = JSON.parse(readFileSync(goldenPath, "utf-8")) as unknown;
  const items = parseGoldenSet(raw);
  const predictions = await Promise.all(items.map((item) => noEdits(item.input)));
  const result = score(items, predictions);
  console.log(formatReport(result));
}

if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    resolve(process.argv[1]) === fileURLToPath(import.meta.url))
) {
  await main();
}
