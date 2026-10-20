// Anonymous learner identity, shared by proxy.ts and lib/learner.ts.
// Phase 5 login links this id to an account (learner_profiles.user_id).

export const LEARNER_COOKIE = "fluency_learner";

// Browsers cap cookie lifetime at 400 days.
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isLearnerId(value: string | undefined): value is string {
  return isUuid(value);
}

export function newLearnerId(): string {
  return crypto.randomUUID();
}

export function learnerCookieOptions(production = process.env.NODE_ENV === "production") {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: production,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}
