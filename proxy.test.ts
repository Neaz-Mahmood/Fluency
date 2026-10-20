// Next.js 16.4 docs call this unstable_doesProxyMatch, but the installed build still
// exports the pre-rename name.
import { unstable_doesMiddlewareMatch as doesProxyMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { LEARNER_COOKIE, isLearnerId } from "@/lib/learner-id";
import { config, proxy } from "@/proxy";

const EXISTING_ID = "f6536803-6692-4a9b-a8bf-64eb56f56c61";

function request(cookie?: string) {
  return new NextRequest("http://localhost/practice", {
    headers: cookie ? { cookie } : {},
  });
}

describe("proxy", () => {
  it("assigns a learner id when there is no cookie", () => {
    const response = proxy(request());
    const cookie = response.cookies.get(LEARNER_COOKIE);

    expect(isLearnerId(cookie?.value)).toBe(true);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    // Forwarded on the same request, so the first request already sees it.
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      `${LEARNER_COOKIE}=${cookie?.value}`,
    );
  });

  it("keeps a valid existing id", () => {
    const response = proxy(request(`${LEARNER_COOKIE}=${EXISTING_ID}`));
    expect(response.cookies.get(LEARNER_COOKIE)).toBeUndefined();
  });

  it("replaces an invalid id", () => {
    const response = proxy(request(`${LEARNER_COOKIE}=not-a-uuid`));
    const value = response.cookies.get(LEARNER_COOKIE)?.value;
    expect(isLearnerId(value)).toBe(true);
    expect(value).not.toBe("not-a-uuid");
  });

  it("keeps other cookies on the forwarded request", () => {
    const response = proxy(request("theme=dark"));
    expect(response.headers.get("x-middleware-request-cookie")).toContain("theme=dark");
  });
});

describe("proxy matcher", () => {
  it.each(["/", "/practice", "/api/chat"])("runs on %s", (url) => {
    expect(doesProxyMatch({ config, url })).toBe(true);
  });

  it.each(["/_next/static/chunk.js", "/_next/image?url=x", "/favicon.ico"])("skips %s", (url) => {
    expect(doesProxyMatch({ config, url })).toBe(false);
  });
});
