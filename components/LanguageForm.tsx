"use client";

import { useActionState } from "react";

import { saveLanguages, type OnboardingState } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { NATIVE_LANGUAGES, type NativeLanguage } from "@/lib/languages";

export function LanguageForm({ current }: { current?: NativeLanguage }) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(saveLanguages, {
    status: "idle",
  });
  const defaultSelected = current ?? NATIVE_LANGUAGES[0]?.code;

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.status === "error" ? (
        <p
          role="alert"
          className="rounded border border-[#ba1a1a]/20 bg-[#ffdad6] px-3 py-2 text-xs font-medium text-[#93000a]"
        >
          Something went wrong. Try again. · কিছু একটা ভুল হয়েছে। আবার চেষ্টা করুন।
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Native language</legend>
        {NATIVE_LANGUAGES.map((lang) => {
          const id = `native-language-${lang.code}`;
          return (
            <div key={lang.code} className="flex items-center gap-2">
              <input
                type="radio"
                id={id}
                name="nativeLanguage"
                value={lang.code}
                defaultChecked={lang.code === defaultSelected}
                className="size-4 accent-[#03256c]"
              />
              <label htmlFor={id} className="cursor-pointer text-sm font-medium text-[#03256c]">
                {lang.label}
              </label>
            </div>
          );
        })}
      </fieldset>

      <p className="text-xs text-[#556b82]">
        Learning: English (US) · শিখছেন: ইংরেজি (যুক্তরাষ্ট্র)
      </p>

      <div>
        <Button type="submit" disabled={pending}>
          Continue · এগিয়ে যান
        </Button>
      </div>
    </form>
  );
}
