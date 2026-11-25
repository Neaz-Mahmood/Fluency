import { afterEach, describe, expect, it, vi } from "vitest";

import { FIRST_TOKEN_TIMEOUT_MS, IDLE_TIMEOUT_MS, startReply } from "@/lib/reply-stream";

function fakeReply(chunks: AsyncIterable<string>) {
  const abort = vi.fn();
  return { reply: { abort, text: chunks }, abort };
}

async function* from(values: string[]) {
  for (const value of values) {
    yield value;
  }
}

async function* never() {
  await new Promise<void>(() => {});
}

async function toArray(iterable: AsyncIterable<string>): Promise<string[]> {
  const result: string[] = [];
  for await (const chunk of iterable) {
    result.push(chunk);
  }
  return result;
}

describe("startReply", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the first non-empty chunk as first and yields the rest in order", async () => {
    const { reply, abort } = fakeReply(from(["Hello", " world", "!"]));

    const { first, rest } = await startReply(reply);
    expect(first).toBe("Hello");

    const restChunks = await toArray(rest);
    expect(restChunks.join("")).toBe(" world!");
    expect(abort).not.toHaveBeenCalled();
  });

  it("skips leading empty chunks", async () => {
    const { reply } = fakeReply(from(["", "", "Hi", " there"]));

    const { first, rest } = await startReply(reply);
    expect(first).toBe("Hi");

    const restChunks = await toArray(rest);
    expect(restChunks).toEqual([" there"]);
  });

  it("rejects with kind 'failed' when the source throws before any chunk", async () => {
    async function* boom(): AsyncGenerator<string> {
      throw new Error("boom");
    }
    const { reply } = fakeReply(boom());

    await expect(startReply(reply)).rejects.toMatchObject({
      name: "ProviderError",
      kind: "failed",
      message: "boom",
    });
  });

  it("rejects with kind 'busy' when the source throws an error with status 503", async () => {
    async function* busy(): AsyncGenerator<string> {
      throw Object.assign(new Error("overloaded"), { status: 503 });
    }
    const { reply } = fakeReply(busy());

    await expect(startReply(reply)).rejects.toMatchObject({
      name: "ProviderError",
      kind: "busy",
      status: 503,
      message: "overloaded",
    });
  });

  it.each([
    ["an empty stream", []],
    ["only empty strings", ["", ""]],
  ])("rejects with kind 'failed' when the source finishes with no text (%s)", async (_, values) => {
    const { reply } = fakeReply(from(values));

    await expect(startReply(reply)).rejects.toMatchObject({
      name: "ProviderError",
      kind: "failed",
      message: "The provider finished without any text.",
    });
  });

  it("rejects with kind 'timeout' and aborts once when the source never yields", async () => {
    vi.useFakeTimers();
    const { reply, abort } = fakeReply(never());

    const promise = startReply(reply);
    const assertion = expect(promise).rejects.toMatchObject({
      name: "ProviderError",
      kind: "timeout",
      message: "No first token within 20000 ms.",
    });

    await vi.advanceTimersByTimeAsync(FIRST_TOKEN_TIMEOUT_MS - 1);
    expect(abort).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await assertion;

    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("times out and aborts if the source goes idle mid-stream after first chunk", async () => {
    vi.useFakeTimers();
    async function* yieldsThenNever(): AsyncGenerator<string> {
      yield "Hi";
      await new Promise<void>(() => {});
    }
    const { reply, abort } = fakeReply(yieldsThenNever());

    const { first, rest } = await startReply(reply);
    expect(first).toBe("Hi");
    expect(abort).not.toHaveBeenCalled();

    const consumePromise = toArray(rest);
    const assertion = expect(consumePromise).rejects.toMatchObject({
      name: "ProviderError",
      kind: "timeout",
      message: "No chunk within 15000 ms.",
    });

    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS - 1);
    expect(abort).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await assertion;

    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("rejects with ProviderError when the source throws mid-stream after first chunk", async () => {
    async function* throwsMidStream(): AsyncGenerator<string> {
      yield "Hi";
      throw new Error("mid-stream failure");
    }
    const { reply } = fakeReply(throwsMidStream());

    const { first, rest } = await startReply(reply);
    expect(first).toBe("Hi");

    await expect(toArray(rest)).rejects.toMatchObject({
      name: "ProviderError",
      kind: "failed",
      message: "mid-stream failure",
    });
  });

  it("uses default timeouts when no options are passed", async () => {
    expect(FIRST_TOKEN_TIMEOUT_MS).toBe(20_000);
    expect(IDLE_TIMEOUT_MS).toBe(15_000);

    vi.useFakeTimers();
    const { reply, abort } = fakeReply(never());

    const promise = startReply(reply);
    const assertion = expect(promise).rejects.toMatchObject({
      name: "ProviderError",
      kind: "timeout",
      message: "No first token within 20000 ms.",
    });

    await vi.advanceTimersByTimeAsync(19_999);
    expect(abort).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("respects custom timeout options", async () => {
    vi.useFakeTimers();
    const { reply, abort } = fakeReply(never());

    const promise = startReply(reply, { firstTokenTimeoutMs: 5_000 });
    const assertion = expect(promise).rejects.toMatchObject({
      name: "ProviderError",
      kind: "timeout",
      message: "No first token within 5000 ms.",
    });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(abort).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("skips empty chunks in rest and resets the idle timeout", async () => {
    vi.useFakeTimers();

    async function* delayedWithEmpty(): AsyncGenerator<string> {
      yield "Hi";
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      yield "";
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      yield " there";
    }

    const { reply } = fakeReply(delayedWithEmpty());
    const { first, rest } = await startReply(reply);
    expect(first).toBe("Hi");

    const restPromise = toArray(rest);
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await restPromise;

    expect(result).toEqual([" there"]);
  });

  it("does not reset the first-token timeout on empty chunks", async () => {
    vi.useFakeTimers();

    async function* emptyThenNever(): AsyncGenerator<string> {
      await new Promise((resolve) => setTimeout(resolve, 12_000));
      yield "";
      await new Promise<void>(() => {});
    }

    const { reply, abort } = fakeReply(emptyThenNever());
    const promise = startReply(reply);
    const assertion = expect(promise).rejects.toMatchObject({
      kind: "timeout",
      message: "No first token within 20000 ms.",
    });

    await vi.advanceTimersByTimeAsync(12_000);
    expect(abort).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(7_999);
    expect(abort).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("does not emit unhandled rejections when abandoned next promise rejects after abort", async () => {
    vi.useFakeTimers();

    let rejectPending: ((err: unknown) => void) | undefined;
    const abort = vi.fn(() => {
      rejectPending?.(new Error("provider aborted"));
    });

    const text: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return new Promise((_, reject) => {
              rejectPending = reject;
            });
          },
        };
      },
    };

    const promise = startReply({ abort, text }, { firstTokenTimeoutMs: 1_000 });
    const assertion = expect(promise).rejects.toMatchObject({
      kind: "timeout",
      message: "No first token within 1000 ms.",
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("does not emit unhandled rejections when abandoned next promise rejects after idle abort", async () => {
    vi.useFakeTimers();

    let rejectPending: ((err: unknown) => void) | undefined;
    const abort = vi.fn(() => {
      rejectPending?.(new Error("provider aborted idle"));
    });

    let yieldedFirst = false;
    const text: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (!yieldedFirst) {
              yieldedFirst = true;
              return Promise.resolve({ done: false, value: "Hi" });
            }
            return new Promise((_, reject) => {
              rejectPending = reject;
            });
          },
        };
      },
    };

    const { first, rest } = await startReply({ abort, text }, { idleTimeoutMs: 1_000 });
    expect(first).toBe("Hi");

    const consumePromise = toArray(rest);
    const assertion = expect(consumePromise).rejects.toMatchObject({
      kind: "timeout",
      message: "No chunk within 1000 ms.",
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(abort).toHaveBeenCalledTimes(1);
  });
});
