import { NextResponse, type NextRequest } from "next/server";

import { LEARNER_COOKIE, isLearnerId, learnerCookieOptions, newLearnerId } from "@/lib/learner-id";

// Gives every browser an anonymous learner id. No database work here: lib/learner.ts
// creates the learner_profiles row the first time a route needs it.
export function proxy(request: NextRequest) {
  if (isLearnerId(request.cookies.get(LEARNER_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const learnerId = newLearnerId();
  // Forward the cookie on this request too, so the first request already sees it.
  request.cookies.set(LEARNER_COOKIE, learnerId);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(LEARNER_COOKIE, learnerId, learnerCookieOptions());
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
