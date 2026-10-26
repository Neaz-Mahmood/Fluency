export type PhonemeResult = {
  Phoneme: string;
  PronunciationAssessment?: {
    AccuracyScore?: number;
    NBestPhonemes?: { Phoneme: string; Score: number }[];
  };
};

export type WordResult = {
  Word: string;
  PronunciationAssessment?: {
    AccuracyScore?: number;
    ErrorType?: string;
    Feedback?: {
      Prosody?: {
        Break?: unknown;
        Intonation?: unknown;
      };
    };
  };
  Syllables?: unknown[];
  Phonemes?: PhonemeResult[];
};

export type PhraseResult = {
  DisplayText: string;
  Offset: number; // 100-ns units from the start of the audio
  Duration: number; // 100-ns units
  NBest: {
    PronunciationAssessment?: Record<string, number>;
    Words?: WordResult[];
  }[];
};

export type PhonemeMismatch = {
  word: string;
  expected: string;
  heard: string;
  score: number;
};

export type WeakWord = { word: string; score: number; errorType: string };

// Overall Azure scores for one learner turn, 0–100. Null when Azure didn't return that score.
export type PronunciationScores = {
  accuracy: number | null;
  fluency: number | null;
  prosody: number | null;
  completeness: number | null;
  pronScore: number | null;
  weakWords: WeakWord[];
  mismatches: PhonemeMismatch[];
};

export function weakWords(phrases: PhraseResult[], below = 60): WeakWord[] {
  const result: WeakWord[] = [];
  for (const phrase of phrases) {
    const words = phrase.NBest?.[0]?.Words ?? [];
    for (const w of words) {
      const score = w.PronunciationAssessment?.AccuracyScore;
      if (typeof score === "number" && score < below) {
        result.push({
          word: w.Word,
          score,
          errorType: w.PronunciationAssessment?.ErrorType ?? "",
        });
      }
    }
  }
  return result;
}

export function phonemeMismatches(phrases: PhraseResult[], below = 60): PhonemeMismatch[] {
  const mismatches: PhonemeMismatch[] = [];
  for (const phrase of phrases) {
    const words = phrase.NBest?.[0]?.Words ?? [];
    for (const w of words) {
      for (const p of w.Phonemes ?? []) {
        const score = p.PronunciationAssessment?.AccuracyScore;
        const nbest = p.PronunciationAssessment?.NBestPhonemes;
        if (typeof score === "number" && score < below && nbest && nbest.length > 0) {
          let top = nbest[0];
          for (let i = 1; i < nbest.length; i++) {
            if (nbest[i].Score > top.Score) {
              top = nbest[i];
            }
          }
          if (top.Phoneme !== p.Phoneme) {
            mismatches.push({
              word: w.Word,
              expected: p.Phoneme,
              heard: top.Phoneme,
              score,
            });
          }
        }
      }
    }
  }
  return mismatches;
}

function computeWeightedScore(phrases: PhraseResult[], key: string): number | null {
  let weightedSum = 0;
  let totalDuration = 0;

  for (const phrase of phrases) {
    const assessment = phrase.NBest?.[0]?.PronunciationAssessment;
    const dur = phrase.Duration ?? 0;
    if (!assessment || dur <= 0) continue;
    const val = assessment[key];
    if (typeof val === "number" && Number.isFinite(val)) {
      weightedSum += val * dur;
      totalDuration += dur;
    }
  }

  if (totalDuration <= 0) {
    return null;
  }

  return Math.round((weightedSum / totalDuration) * 10) / 10;
}

export function summarizePhrases(phrases: PhraseResult[]): PronunciationScores {
  return {
    accuracy: computeWeightedScore(phrases, "AccuracyScore"),
    fluency: computeWeightedScore(phrases, "FluencyScore"),
    prosody: computeWeightedScore(phrases, "ProsodyScore"),
    completeness: computeWeightedScore(phrases, "CompletenessScore"),
    pronScore: computeWeightedScore(phrases, "PronScore"),
    weakWords: weakWords(phrases),
    mismatches: phonemeMismatches(phrases),
  };
}
