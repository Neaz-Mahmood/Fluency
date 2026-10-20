import { afterEach, describe, expect, it, vi } from "vitest";

import { streamGoogleReply } from "@/lib/google";
import { ProviderError } from "@/lib/provider-errors";

const options = {
  apiKey: "test-key",
  system: "You help the learner practice.",
  messages: [{ role: "user" as const, content: "Hi" }],
};

async function drain(text: AsyncIterable<string>): Promise<void> {
  for await (const _ of text) {
    void _;
  }
}

describe("streamGoogleReply", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps an overloaded response to a busy ProviderError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: "This model is currently experiencing high demand." },
            }),
            { status: 503 },
          ),
      ),
    );

    const reply = streamGoogleReply(options);
    await expect(drain(reply.text)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ kind: "busy", status: 503 });
      expect((error as ProviderError).message).toContain("high demand");
      return true;
    });
  });

  it("maps a 400 response to a failed ProviderError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad request", { status: 400 })),
    );

    const reply = streamGoogleReply(options);
    await expect(drain(reply.text)).rejects.toMatchObject({ kind: "failed", status: 400 });
  });

  it("yields text from a 200 SSE response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(`data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n`, {
            status: 200,
          }),
      ),
    );

    const reply = streamGoogleReply(options);
    let text = "";
    for await (const chunk of reply.text) text += chunk;
    expect(text).toEqual("Hello");
  });
});
