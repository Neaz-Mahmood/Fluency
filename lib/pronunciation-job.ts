import "server-only";

import { generateText } from "@/lib/ai";
import { getDb } from "@/lib/db";
import type { LearnerProfile } from "@/lib/db/schema";
import { explanationLanguage } from "@/lib/feedback";
import {
  buildTipsInput,
  buildTipsSystemPrompt,
  parseTips,
  summarizeSessionPronunciation,
  tipFocuses,
  waitForSettledCount,
  type PronunciationTip,
} from "@/lib/pronunciation-recap";
import {
  clearPronunciationStatus,
  countSessionScores,
  loadSessionScores,
  markPronunciationFailed,
  recordPronunciationPatterns,
  savePronunciationTips,
} from "@/lib/pronunciation-store";
import { resolveProvider } from "@/lib/provider";

export async function runPronunciationFeedback(
  learner: Pick<LearnerProfile, "learnerId" | "nativeLanguage" | "cefrSpeaking">,
  sessionId: string,
): Promise<void> {
  try {
    const db = getDb();
    const count = await waitForSettledCount(() => countSessionScores(db, sessionId));

    if (count === 0) {
      await clearPronunciationStatus(db, {
        learnerId: learner.learnerId,
        sessionId,
      });
      return;
    }

    const turns = await loadSessionScores(db, {
      learnerId: learner.learnerId,
      sessionId,
    });
    const summary = summarizeSessionPronunciation(turns);

    await recordPronunciationPatterns(db, {
      learnerId: learner.learnerId,
      patterns: summary.patterns,
    });

    const allowed = tipFocuses(summary);
    let tips: PronunciationTip[] = [];

    if (allowed.size > 0) {
      const selected = resolveProvider();
      if ("error" in selected) {
        console.error("Could not build pronunciation tips.", selected.error);
      } else {
        try {
          const text = await generateText(selected, {
            model: "feedback",
            label: "pronunciation-tips",
            maxTokens: 2000,
            system: buildTipsSystemPrompt(explanationLanguage(learner)),
            messages: [{ role: "user", content: buildTipsInput(summary) }],
          });
          const parsed = parseTips(text, allowed);
          if (!parsed) {
            console.error("Could not build pronunciation tips.", text);
          } else {
            tips = parsed;
          }
        } catch (tipsError) {
          console.error("Could not build pronunciation tips.", tipsError);
        }
      }
    }

    await savePronunciationTips(db, {
      learnerId: learner.learnerId,
      sessionId,
      tips,
    });
  } catch (error) {
    console.error("Could not build pronunciation feedback.", error);
    try {
      const db = getDb();
      await markPronunciationFailed(db, {
        learnerId: learner.learnerId,
        sessionId,
      });
    } catch (failedError) {
      console.error("Could not mark pronunciation feedback as failed.", failedError);
    }
  }
}
