import { cronAuthorization, sweep } from "@/lib/sweep";

// The sweep for every learner, called by a scheduler with CRON_SECRET (Vercel Cron sends it as a
// bearer token). Learners' own sweeps run when they open Practice or History.
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = cronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth === "disabled") {
    return Response.json(
      { error: "Sweeping is off." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (auth === "unauthorized") {
    return Response.json(
      { error: "Unauthorized." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const result = await sweep({ limit: 20 });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
