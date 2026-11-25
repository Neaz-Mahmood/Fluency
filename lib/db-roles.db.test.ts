import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@/lib/db";
import { deleteLearner, ensureLearnerProfile, setVoiceConsent } from "@/lib/learner";
import { newLearnerId } from "@/lib/learner-id";
import { savePronunciationScore } from "@/lib/pronunciation-store";
import { saveExchange, startSession } from "@/lib/sessions";
import { recordVoiceSeconds } from "@/lib/voice-quota";
import { createTestDb, resetTestDb } from "@/test/db";
import { TEST_DATABASE_URL } from "@/test/db-url";
import { loadVoiceContext } from "@/worker/context";
import { hasVoiceConsent } from "@/worker/meter";

// The production logins (drizzle/0007_app_roles.sql, FLU-100). Each test runs real code as the
// role, the way the deployed app and worker would.

process.env.DATABASE_URL = TEST_DATABASE_URL;

const db = createTestDb();

beforeEach(async () => {
  await resetTestDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

type Role = "fluency_app" | "fluency_worker";

// SET LOCAL lasts until the transaction ends, so the role never leaks into other tests.
async function asRole<T>(role: Role, work: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`));
    return work(tx as unknown as Db);
  });
}

// Postgres's insufficient_privilege. Drizzle wraps driver errors, so look at the cause too.
async function expectDenied(work: Promise<unknown>) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught as { code?: string; cause?: { code?: string } },
  );
  expect(error, "expected a permission error").not.toBeNull();
  expect(error?.cause?.code ?? error?.code).toBe("42501");
}

async function consentingLearner() {
  const { learnerId } = await ensureLearnerProfile(db, newLearnerId());
  await setVoiceConsent(db, learnerId, true);
  return learnerId;
}

describe("fluency_worker", () => {
  it("runs everything the voice worker does", async () => {
    const learnerId = await consentingLearner();
    const now = new Date();

    const history = await asRole("fluency_worker", async (tx) => {
      expect(await hasVoiceConsent(tx, learnerId)).toBe(true);

      const fresh = await loadVoiceContext(
        tx,
        { learnerId, scenarioId: "cafe", sessionId: null },
        now,
      );
      expect(fresh).not.toHaveProperty("error");

      const session = await startSession(tx, {
        learnerId,
        mode: "conversation",
        scenarioId: "cafe",
      });
      const userTurnId = crypto.randomUUID();
      await saveExchange(tx, {
        sessionId: session.sessionId,
        userText: "I would like a coffee, please.",
        inputMode: "voice",
        replyText: "Sure! Hot or iced?",
        replyTurnId: crypto.randomUUID(),
        firstTokenMs: 400,
        userTurnId,
      });

      await recordVoiceSeconds(tx, learnerId, 15, now);
      await recordVoiceSeconds(tx, learnerId, 15, now);

      await savePronunciationScore(tx, {
        turnId: userTurnId,
        sessionId: session.sessionId,
        learnerId,
        audioMs: 2400,
        accuracy: 90,
        fluency: 85,
        prosody: 80,
        completeness: 100,
        pronScore: 86,
        weakWords: [],
        mismatches: [],
      });

      const resumed = await loadVoiceContext(
        tx,
        { learnerId, scenarioId: "cafe", sessionId: session.sessionId },
        now,
      );
      return "error" in resumed ? resumed : resumed.history;
    });

    expect(history).toHaveLength(2);
  });

  it("can't delete, change learners, read feedback or change the schema", async () => {
    const learnerId = await consentingLearner();

    await expectDenied(
      asRole("fluency_worker", (tx) =>
        tx.execute(sql`DELETE FROM learner_profiles WHERE learner_id = ${learnerId}`),
      ),
    );
    await expectDenied(
      asRole("fluency_worker", (tx) =>
        tx.execute(
          sql`UPDATE learner_profiles SET compact_tutor_summary = 'x' WHERE learner_id = ${learnerId}`,
        ),
      ),
    );
    await expectDenied(
      asRole("fluency_worker", (tx) => tx.execute(sql`SELECT * FROM session_feedback`)),
    );
    await expectDenied(
      asRole("fluency_worker", (tx) => tx.execute(sql`DELETE FROM session_turns`)),
    );
    await expectDenied(asRole("fluency_worker", (tx) => tx.execute(sql`DROP TABLE sessions`)));
  });
});

describe("fluency_app", () => {
  it("reads and writes learner data, including the cascading delete", async () => {
    const learnerId = await consentingLearner();

    const deleted = await asRole("fluency_app", (tx) => deleteLearner(tx, learnerId));

    expect(deleted).toBe(true);
  });

  it("can't change the schema", async () => {
    await expectDenied(asRole("fluency_app", (tx) => tx.execute(sql`DROP TABLE sessions`)));
    await expectDenied(
      asRole("fluency_app", (tx) => tx.execute(sql`CREATE TABLE public.not_allowed (id int)`)),
    );
  });

  it("gets tables a later migration adds, and the worker doesn't", async () => {
    // Created as the owner, like a migration. The sentinel rolls everything back.
    const rolledBack = new Error("roll back");
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`CREATE TABLE later_table (id int)`);
        await tx.transaction(async (sp) => {
          await sp.execute(sql`SET LOCAL ROLE fluency_app`);
          await sp.execute(sql`INSERT INTO later_table VALUES (1)`);
        });
        await expectDenied(
          tx.transaction(async (sp) => {
            await sp.execute(sql`SET LOCAL ROLE fluency_worker`);
            await sp.execute(sql`SELECT * FROM later_table`);
          }),
        );
        throw rolledBack;
      })
      .catch((error: unknown) => {
        if (error !== rolledBack) throw error;
      });
  });
});
