export type PronunciationPattern = {
  code: string; // learner_error_patterns.error_code, at most 64 chars
  kind: "phoneme" | "prosody";
  target: string; // the English sound or feature, e.g. "/v/" or "word stress"
  heard: string; // what Bangla speakers often produce instead, e.g. "[bʱ] or [b]"
  examples: string[]; // 2–4 English words or short phrases where it shows up
  tip: string; // one short, friendly English sentence on how to fix it
};

export const BN_EN_PRONUNCIATION_PATTERNS: readonly PronunciationPattern[] = [
  {
    code: "IPA:/v/_to_[b]",
    kind: "phoneme",
    target: "/v/",
    heard: "[b] or [bʱ]",
    examples: ["very", "video", "seven"],
    tip: "Touch your top teeth to your bottom lip and let your voice buzz: 'very', not 'bhery'.",
  },
  {
    code: "IPA:/w/_to_[v]",
    kind: "phoneme",
    target: "/w/",
    heard: "[v] or [ʋ]",
    examples: ["west", "we", "wine"],
    tip: "Round your lips into a small circle without touching your teeth: 'west', not 'vest'.",
  },
  {
    code: "IPA:/f/_to_[pʰ]",
    kind: "phoneme",
    target: "/f/",
    heard: "[pʰ]",
    examples: ["fan", "coffee", "life"],
    tip: "Rest your top teeth lightly on your bottom lip and gently blow air: 'fan', not 'phan'.",
  },
  {
    code: "IPA:/z/_to_[dʒ]",
    kind: "phoneme",
    target: "/z/",
    heard: "[dʒ]",
    examples: ["zoo", "zero", "busy"],
    tip: "Keep your teeth close together and make a continuous buzzing sound: 'zoo', not 'joo'.",
  },
  {
    code: "IPA:/θ/_to_[t̪ʰ]",
    kind: "phoneme",
    target: "/θ/",
    heard: "[t̪ʰ]",
    examples: ["think", "three", "month"],
    tip: "Put the tip of your tongue between your teeth and blow air gently: 'think', not 'tink'.",
  },
  {
    code: "IPA:/ð/_to_[d̪]",
    kind: "phoneme",
    target: "/ð/",
    heard: "[d̪]",
    examples: ["this", "mother", "with"],
    tip: "Place your tongue tip between your teeth and hum with your voice: 'this', not 'dis'.",
  },
  {
    code: "IPA:/ʃ/_to_[s]",
    kind: "phoneme",
    target: "/ʃ/",
    heard: "[s] for /ʃ/ or [ʃ] for /s/",
    examples: ["she", "sea", "shop"],
    tip: "Round your lips for 'sh' in 'she', and smile with teeth together for 's' in 'sea'.",
  },
  {
    code: "IPA:/sC/_to_[isC]",
    kind: "phoneme",
    target: "/sC/",
    heard: "[isC]",
    examples: ["school", "station", "street"],
    tip: "Start right away with the hissing 's' sound without an 'i' in front: 'school', not 'ischool'.",
  },
  {
    code: "IPA:/æ/_to_[e]",
    kind: "phoneme",
    target: "/æ/",
    heard: "[e] or [ɛ]",
    examples: ["cat", "bad", "man"],
    tip: "Open your mouth wider and drop your jaw lower for the short 'a': 'cat', not 'ket'.",
  },
  {
    code: "IPA:/ʌ/_to_[a]",
    kind: "phoneme",
    target: "/ʌ/",
    heard: "[a] or [ɔ]",
    examples: ["cup", "bus", "love"],
    tip: "Relax your mouth and say a short, neutral 'uh': 'cup' sounds like 'kuhp', not 'kaap'.",
  },
  {
    code: "IPA:/ɪ/_to_[i]",
    kind: "phoneme",
    target: "/ɪ/",
    heard: "[i] (merged with /iː/)",
    examples: ["ship", "sheep", "live", "leave"],
    tip: "Keep 'ship' short and relaxed, but stretch your lips and hold 'sheep' longer.",
  },
  {
    code: "IPA:/eɪ/_to_[e]",
    kind: "phoneme",
    target: "/eɪ/",
    heard: "[e]",
    examples: ["say", "day", "make"],
    tip: "Glide smoothly from 'eh' to 'ee' instead of holding a flat single vowel: 'say', not 'se'.",
  },
  {
    code: "IPA:/oʊ/_to_[o]",
    kind: "phoneme",
    target: "/oʊ/",
    heard: "[o]",
    examples: ["go", "road", "home"],
    tip: "Round your lips at the end to glide into 'oo' instead of a flat vowel: 'go', not 'goh'.",
  },
  {
    code: "IPA:/t/_to_[ʈ]",
    kind: "phoneme",
    target: "/t/ and /d/",
    heard: "[ʈ] or [ɖ]",
    examples: ["tea", "doctor", "today"],
    tip: "Touch your tongue tip just behind your top teeth, without curling it back, for a soft 't' and 'd'.",
  },
  {
    code: "PROSODY:word_stress",
    kind: "prosody",
    target: "word stress",
    heard: "stress on the first syllable or evenly spread",
    examples: ["hotel", "computer", "develop"],
    tip: "Make the stressed syllable louder, longer, and higher in pitch: ho-TEL, not HO-tel.",
  },
  {
    code: "PROSODY:weak_forms",
    kind: "prosody",
    target: "weak forms",
    heard: "full vowels in unstressed function words",
    examples: ["to", "for", "a", "can in 'I can go'"],
    tip: "Use a quick relaxed 'uh' (/ə/) in little words like 'to' and 'can' when speaking naturally.",
  },
];

export function findPattern(code: string): PronunciationPattern | undefined {
  return BN_EN_PRONUNCIATION_PATTERNS.find((pattern) => pattern.code === code);
}
