export type ProviderErrorKind = "busy" | "timeout" | "failed";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ProviderError";
    this.kind = kind;
    this.status = options?.status;
  }
}

// 429, 503 and 529 are "busy"; 408 and 504 are "timeout"; every other status is "failed".
export function kindForStatus(status: number): ProviderErrorKind {
  if (status === 429 || status === 503 || status === 529) return "busy";
  if (status === 408 || status === 504) return "timeout";
  return "failed";
}

function hasNumericStatus(error: unknown): error is { status: number } {
  if (typeof error !== "object" || error === null) return false;
  return typeof (error as { status?: unknown }).status === "number";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Provider request failed.";
}

// Normalizes anything thrown while talking to a provider.
export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  if (hasNumericStatus(error)) {
    return new ProviderError(kindForStatus(error.status), messageOf(error), {
      status: error.status,
      cause: error,
    });
  }

  // DOMException TimeoutError (for example AbortSignal.timeout) is an Error in this runtime.
  if (error instanceof Error && error.name === "TimeoutError") {
    return new ProviderError("timeout", error.message, { cause: error });
  }

  return new ProviderError("failed", messageOf(error), { cause: error });
}

// What the learner sees.
export function providerErrorResponse(error: ProviderError): { status: number; message: string } {
  switch (error.kind) {
    case "busy":
      return {
        status: 503,
        message: "The AI partner is busy right now. Try again in a moment.",
      };
    case "timeout":
      return { status: 504, message: "The AI partner took too long to answer. Try again." };
    case "failed":
      return { status: 502, message: "The AI partner could not reply. Try again." };
  }
}
