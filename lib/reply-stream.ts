import type { TextReply } from "@/lib/anthropic";
import { ProviderError, toProviderError } from "@/lib/provider-errors";

export const FIRST_TOKEN_TIMEOUT_MS = 20_000;
export const IDLE_TIMEOUT_MS = 15_000;

export type StartedReply = {
  first: string; // the first non-empty chunk
  rest: AsyncIterable<string>; // the remaining chunks, with the idle limit applied
};

async function raceNext(
  iterator: AsyncIterator<string>,
  timeoutPromise: Promise<never>,
): Promise<IteratorResult<string>> {
  let nextPromise: Promise<IteratorResult<string>>;
  try {
    nextPromise = Promise.resolve(iterator.next());
  } catch (error) {
    nextPromise = Promise.reject(error);
  }
  nextPromise.catch(() => {});
  return await Promise.race([nextPromise, timeoutPromise]);
}

async function nextWithin(
  iterator: AsyncIterator<string>,
  ms: number,
  timeoutError: Error,
  onTimeout: () => void,
): Promise<IteratorResult<string>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(timeoutError);
        onTimeout();
      }, ms);
    });
    return await raceNext(iterator, timeoutPromise);
  } finally {
    clearTimeout(timer);
  }
}

async function* iterateRest(
  iterator: AsyncIterator<string>,
  reply: TextReply,
  idleTimeoutMs: number,
): AsyncGenerator<string, void, unknown> {
  while (true) {
    let result: IteratorResult<string>;
    try {
      result = await nextWithin(
        iterator,
        idleTimeoutMs,
        new ProviderError("timeout", `No chunk within ${idleTimeoutMs} ms.`),
        () => reply.abort(),
      );
    } catch (error) {
      throw toProviderError(error);
    }

    if (result.done) {
      return;
    }

    if (result.value !== "") {
      yield result.value;
    }
  }
}

export async function startReply(
  reply: TextReply,
  options?: { firstTokenTimeoutMs?: number; idleTimeoutMs?: number },
): Promise<StartedReply> {
  const firstTokenTimeoutMs = options?.firstTokenTimeoutMs ?? FIRST_TOKEN_TIMEOUT_MS;
  const idleTimeoutMs = options?.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const iterator = reply.text[Symbol.asyncIterator]();

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ProviderError("timeout", `No first token within ${firstTokenTimeoutMs} ms.`));
        reply.abort();
      }, firstTokenTimeoutMs);
    });

    while (true) {
      const result = await raceNext(iterator, timeoutPromise);

      if (result.done) {
        throw new ProviderError("failed", "The provider finished without any text.");
      }

      if (result.value !== "") {
        clearTimeout(timer);
        return {
          first: result.value,
          rest: iterateRest(iterator, reply, idleTimeoutMs),
        };
      }
    }
  } catch (error) {
    clearTimeout(timer);
    throw toProviderError(error);
  }
}
