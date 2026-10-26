import { getDb } from "@/lib/db";
import type { LearnerProfile } from "@/lib/db/schema";
import { getLearner } from "@/lib/learner";
import {
  checkVoiceAccess,
  createVoiceToken,
  liveVoiceConfig,
  parseVoiceTokenRequest,
  VOICE_REFUSALS,
  voiceRoomName,
} from "@/lib/voice-token";
import type { VoiceJob } from "@/worker/job";

function jsonResponse(data: unknown, init?: { status?: number }) {
  return Response.json(data, {
    status: init?.status ?? 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = parseVoiceTokenRequest(body);
  if ("error" in parsed) {
    return jsonResponse({ error: parsed.error }, { status: 400 });
  }

  const config = liveVoiceConfig();
  if (!config) {
    return jsonResponse(
      { error: "Live voice isn't set up on this server.", code: "unavailable" },
      { status: 503 },
    );
  }

  let learner: LearnerProfile;
  let access: Awaited<ReturnType<typeof checkVoiceAccess>>;
  try {
    learner = await getLearner();
    access = await checkVoiceAccess(getDb(), learner, parsed, new Date());
  } catch (error) {
    console.error("Could not check voice access:", error);
    return jsonResponse(
      {
        error: "Fluency can't load your profile right now. Try again in a moment.",
        code: "unavailable",
      },
      { status: 503 },
    );
  }

  if ("refusal" in access) {
    const refusalInfo = VOICE_REFUSALS[access.refusal];
    return jsonResponse(
      { error: refusalInfo.error, code: access.refusal },
      { status: refusalInfo.status },
    );
  }

  const job: VoiceJob = {
    learnerId: learner.learnerId,
    scenarioId: parsed.scenarioId,
    sessionId: parsed.sessionId,
  };

  const token = await createVoiceToken(config, voiceRoomName(), job);

  return jsonResponse({
    url: config.url,
    token,
    remainingSeconds: access.remainingSeconds,
  });
}
