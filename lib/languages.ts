// Native languages Fluency supports. Adding one (e.g. Spanish) = a lang_code enum value,
// an entry here, and a dictionary in lib/messages.ts.
export const NATIVE_LANGUAGES = [{ code: "bn-BD", label: "বাংলা", name: "Bangla" }] as const;

export type NativeLanguage = (typeof NATIVE_LANGUAGES)[number]["code"];

export const TARGET_LANGUAGE = "en-US";

export function isNativeLanguage(value: unknown): value is NativeLanguage {
  return typeof value === "string" && NATIVE_LANGUAGES.some((lang) => lang.code === value);
}

// English name of a native language, for prompts; null when unknown or unset.
export function nativeLanguageName(code: string | null | undefined): string | null {
  if (!code) return null;
  const match = NATIVE_LANGUAGES.find((lang) => lang.code === code);
  return match?.name ?? null;
}
