import "server-only";

export type ProviderId = "claude" | "google";

type Env = Record<string, string | undefined>;

export type ProviderSelection =
  | { provider: ProviderId; apiKey: string }
  | { error: string };

function configuredKey(env: Env, names: string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return "";
}

export function resolveProvider(env: Env = process.env): ProviderSelection {
  const flag = env.AI_PROVIDER?.trim().toLowerCase() ?? "";
  const claudeKey = configuredKey(env, ["CLAUDE_API_KEY", "ANTHROPIC_API_KEY"]);
  const googleKey = configuredKey(env, ["GOOGLE_API_KEY", "GEMINI_API_KEY"]);

  if (flag && flag !== "claude" && flag !== "google") {
    return { error: "AI_PROVIDER must be claude or google." };
  }

  if (flag === "claude" && !claudeKey) {
    return { error: "AI_PROVIDER is claude, but CLAUDE_API_KEY is not set." };
  }
  if (flag === "google" && !googleKey) {
    return { error: "AI_PROVIDER is google, but GOOGLE_API_KEY is not set." };
  }
  if (flag === "claude") return { provider: "claude", apiKey: claudeKey };
  if (flag === "google") return { provider: "google", apiKey: googleKey };

  if (claudeKey && googleKey) {
    return {
      error: "Both CLAUDE_API_KEY and GOOGLE_API_KEY are set. Set AI_PROVIDER to claude or google.",
    };
  }
  if (claudeKey) return { provider: "claude", apiKey: claudeKey };
  if (googleKey) return { provider: "google", apiKey: googleKey };

  return { error: "Set CLAUDE_API_KEY or GOOGLE_API_KEY." };
}
