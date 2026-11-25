import "server-only";

export type ProviderId = "claude" | "google" | "opencode";

type Env = Record<string, string | undefined>;

export type ProviderSelection = { provider: ProviderId; apiKey: string } | { error: string };

// The first name is the one shown in errors; the rest are accepted aliases.
const KEY_NAMES: Record<ProviderId, string[]> = {
  claude: ["CLAUDE_API_KEY", "ANTHROPIC_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  opencode: ["OPENCODE_API_KEY"],
};

const PROVIDERS = Object.keys(KEY_NAMES) as ProviderId[];

function configuredKey(env: Env, names: string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function isProviderId(value: string): value is ProviderId {
  return (PROVIDERS as string[]).includes(value);
}

export function resolveProvider(env: Env = process.env): ProviderSelection {
  const flag = env.AI_PROVIDER?.trim().toLowerCase() ?? "";

  if (flag) {
    if (!isProviderId(flag)) {
      return { error: "AI_PROVIDER must be claude, google or opencode." };
    }
    const apiKey = configuredKey(env, KEY_NAMES[flag]);
    if (!apiKey) {
      return { error: `AI_PROVIDER is ${flag}, but ${KEY_NAMES[flag][0]} is not set.` };
    }
    return { provider: flag, apiKey };
  }

  const configured = PROVIDERS.filter((provider) => configuredKey(env, KEY_NAMES[provider]));
  if (configured.length > 1) {
    const names = configured.map((provider) => KEY_NAMES[provider][0]).join(" and ");
    return {
      error: `More than one key is set (${names}). Set AI_PROVIDER to ${configured.join(" or ")}.`,
    };
  }
  if (configured.length === 1) {
    const provider = configured[0]!;
    return { provider, apiKey: configuredKey(env, KEY_NAMES[provider]) };
  }

  return { error: "Set CLAUDE_API_KEY, GOOGLE_API_KEY or OPENCODE_API_KEY." };
}
