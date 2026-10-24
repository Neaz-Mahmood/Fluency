import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CLAUDE_MODELS, OPENCODE_BASE_URL, streamClaudeReply } from "../../lib/anthropic.ts";

export type Measurement = { firstTokenMs: number; totalMs: number };

export type Row = {
  label: string;
  route: string;
  runs: number;
  ttftP50: number;
  ttftP90: number;
  totalP50: number;
};

// A live reply that hasn't finished in 30 s is a failure, and waiting longer stalls the benchmark.
export const CALL_TIMEOUT_MS = 30_000;

export type Stream = (system: string, user: string, signal: AbortSignal) => AsyncIterable<string>;

export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    throw new Error("Cannot compute percentile of an empty array.");
  }
  if (p < 0 || p > 100 || Number.isNaN(p)) {
    throw new Error(`Percentile p must be between 0 and 100, received ${p}.`);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export function summarize(label: string, route: string, measurements: Measurement[]): Row {
  if (measurements.length === 0) {
    throw new Error("Cannot summarize empty measurements.");
  }
  const firstTokens = measurements.map((m) => m.firstTokenMs);
  const totals = measurements.map((m) => m.totalMs);
  return {
    label,
    route,
    runs: measurements.length,
    ttftP50: Math.round(percentile(firstTokens, 50)),
    ttftP90: Math.round(percentile(firstTokens, 90)),
    totalP50: Math.round(percentile(totals, 50)),
  };
}

export function formatTable(rows: Row[]): string {
  const headers = ["Model", "Route", "Runs", "TTFT p50", "TTFT p90", "Total p50"];
  const stringRows = rows.map((r) => [
    r.label,
    r.route,
    String(r.runs),
    `${Math.round(r.ttftP50)}ms`,
    `${Math.round(r.ttftP90)}ms`,
    `${Math.round(r.totalP50)}ms`,
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

export const SYSTEM_PROMPT = `You are Fluency, a patient English conversation partner. The learner is practicing spoken English with you.

Rules:
- Reply in plain spoken English: one to three short sentences and at most 45 words.
- Stay inside the scenario and ask one natural follow-up so the conversation can continue.
- Use everyday words. If you use a less common word, make its meaning clear from the sentence.
- Do not lecture, do not list corrections, and do not mention that you are an AI unless the learner asks.
- If the learner's English is unclear, answer your best guess and gently rephrase what you think they meant inside your reply.
- No markdown, no bullet points, and no stage directions.

Scenario: you are a café barista. The learner is the customer. Take their order, offer one simple choice if they hesitate, and handle small problems like a missing item or paying.

Learner level: A2 (beginner).
- Use short, high-frequency sentences and speak slowly and simply.
- If the learner is stuck, asks what a word means, or asks how to say something, help briefly in Bangla, then continue in English. It is fine if they mix in Bangla.

What you know about this learner from earlier sessions (use it naturally, do not recite it):
The learner is a college student in Dhaka who visits cafés after class. They like hot tea with milk, vegetable samosas, and chocolate pastries. They practice ordering food and asking about the bill in English, sometimes confusing singular and plural nouns or omitting articles. They prefer polite, friendly greetings and want to build confidence speaking naturally without hesitating.`;

export const TURNS: string[] = [
  "Hi, I want one cup of tea and two samosa please.",
  "Can I get a hot coffee with milk and some sugar?",
  "How much is this chocolate muffin?",
  "Do you have any cold drinks or fresh juice?",
  "Can I pay with cash, or only card?",
  "Could I please have a glass of water too?",
  "Is there any table free near the window?",
  "Can you make the tea with less sugar please?",
  "Can I take this to go, in a paper bag?",
  "Thank you very much. Have a good day!",
];

export async function measure(
  stream: Stream,
  system: string,
  user: string,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<Measurement> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const start = performance.now();
    const iterable = stream(system, user, controller.signal);
    let firstTokenMs: number | null = null;
    let receivedAnyText = false;

    for await (const chunk of iterable) {
      if (controller.signal.aborted) {
        throw new Error(`Timed out after ${timeoutMs} ms.`);
      }
      if (chunk.length > 0) {
        if (firstTokenMs === null) {
          firstTokenMs = performance.now() - start;
        }
        receivedAnyText = true;
      }
    }

    if (controller.signal.aborted) {
      throw new Error(`Timed out after ${timeoutMs} ms.`);
    }

    const end = performance.now();

    if (!receivedAnyText || firstTokenMs === null) {
      throw new Error("No text arrived from stream.");
    }

    return {
      firstTokenMs,
      totalMs: end - start,
    };
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out after ${timeoutMs} ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Keep the model name in sync with GOOGLE_MODEL in lib/google.ts.
export const GOOGLE_MODEL = "gemini-3.8-flash";

type GeminiPart = { text?: string; thought?: boolean };
type GeminiChunk = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
};

function textFromChunk(payload: GeminiChunk): string {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function textFromSseLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return "";
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return "";
  return textFromChunk(JSON.parse(data) as GeminiChunk);
}

async function* readSse(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Google returned an empty stream.");

  const decoder = new TextDecoder();
  let buffer = "";

  const emit = function* (block: string) {
    const lines = block.split("\n");
    const remainder = lines.pop() ?? "";
    for (const line of lines) {
      const text = textFromSseLine(line);
      if (text) yield text;
    }
    return remainder;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = yield* emit(buffer);
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const text = textFromSseLine(buffer);
    if (text) yield text;
  }
}

export function streamGeminiReply(options: {
  apiKey: string;
  system: string;
  user: string;
  signal?: AbortSignal;
}): AsyncIterable<string> {
  return (async function* () {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:streamGenerateContent?alt=sse`;
    const response = await fetch(url, {
      method: "POST",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": options.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.system }] },
        contents: [
          {
            role: "user",
            parts: [{ text: options.user }],
          },
        ],
        generationConfig: { maxOutputTokens: 300 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Google returned status ${response.status}`);
    }

    yield* readSse(response);
  })();
}

export function parseRuns(argv: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--runs" && i + 1 < argv.length) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    if (argv[i].startsWith("--runs=")) {
      const parsed = Number.parseInt(argv[i].slice("--runs=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return 10;
}

type Candidate = {
  label: string;
  route: string;
  stream: Stream;
};

async function main(): Promise<void> {
  const runs = parseRuns(process.argv.slice(2));

  const candidates: Candidate[] = [];

  const anthropicKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  const opencodeKey = process.env.OPENCODE_API_KEY;

  if (anthropicKey || opencodeKey) {
    // Follow AI_PROVIDER like the app does; otherwise prefer a direct key (no proxy hop).
    const useOpencode =
      process.env.AI_PROVIDER?.trim().toLowerCase() === "opencode" ? !!opencodeKey : !anthropicKey;
    const route = useOpencode ? "opencode" : "anthropic";
    const apiKey = (useOpencode ? opencodeKey : anthropicKey)!;
    const baseURL = useOpencode ? OPENCODE_BASE_URL : undefined;

    candidates.push({
      label: CLAUDE_MODELS.live,
      route,
      stream: (system, user, signal) => {
        const reply = streamClaudeReply({
          apiKey,
          baseURL,
          system,
          messages: [{ role: "user", content: user }],
          model: "live",
          maxTokens: 300,
        });
        signal.addEventListener("abort", () => reply.abort(), { once: true });
        if (signal.aborted) {
          reply.abort();
        }
        return reply.text;
      },
    });

    candidates.push({
      label: CLAUDE_MODELS.conversation,
      route,
      stream: (system, user, signal) => {
        const reply = streamClaudeReply({
          apiKey,
          baseURL,
          system,
          messages: [{ role: "user", content: user }],
          model: "conversation",
          maxTokens: 300,
        });
        signal.addEventListener("abort", () => reply.abort(), { once: true });
        if (signal.aborted) {
          reply.abort();
        }
        return reply.text;
      },
    });
  } else {
    console.log(
      "Skipping Claude models: set CLAUDE_API_KEY, ANTHROPIC_API_KEY, or OPENCODE_API_KEY.",
    );
  }

  const googleKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (googleKey) {
    candidates.push({
      label: GOOGLE_MODEL,
      route: "google",
      stream: (system, user, signal) =>
        streamGeminiReply({ apiKey: googleKey, system, user, signal }),
    });
  } else {
    console.log("Skipping Gemini: set GOOGLE_API_KEY or GEMINI_API_KEY.");
  }

  if (candidates.length === 0) {
    console.error("No candidate models could run. Please set API keys.");
    process.exitCode = 2;
    return;
  }

  const rows: Row[] = [];

  for (const candidate of candidates) {
    console.log(`Benchmarking ${candidate.label} via ${candidate.route}...`);

    // One warm-up call (not recorded)
    try {
      await measure(candidate.stream, SYSTEM_PROMPT, TURNS[0]);
    } catch (err) {
      console.warn(
        `[${candidate.label}] Warm-up call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const measurements: Measurement[] = [];
    let firstError: string | null = null;
    for (let i = 0; i < runs; i++) {
      const turn = TURNS[i % TURNS.length];
      try {
        const measurement = await measure(candidate.stream, SYSTEM_PROMPT, turn);
        measurements.push(measurement);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        firstError ??= message;
        console.warn(`[${candidate.label}] Run ${i + 1}/${runs} failed: ${message}`);
      }
    }

    if (measurements.length === 0) {
      console.error(
        `[${candidate.label}] Candidate failed: all runs failed (first error: ${firstError ?? "unknown"}).`,
      );
    } else {
      rows.push(summarize(candidate.label, candidate.route, measurements));
    }
  }

  if (rows.length > 0) {
    console.log("\n" + formatTable(rows));
    console.log(
      "\nNote: OpenCode adds a proxy hop, so use a direct Anthropic key for final numbers.",
    );
  }
}

if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    resolve(process.argv[1]) === fileURLToPath(import.meta.url))
) {
  await main();
}
