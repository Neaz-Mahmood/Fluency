interface RecognitionAlternative {
  transcript: string;
}

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: RecognitionAlternative;
}

interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}

interface RecognitionErrorEvent {
  readonly error: string;
}

interface BrowserRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type RecognitionCtor = new () => BrowserRecognition;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const scoped = window as Window & {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scoped.SpeechRecognition ?? scoped.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow the mic, or type instead.",
  "service-not-allowed": "Speech recognition is unavailable in this browser.",
  network: "Speech recognition needs a network connection in this browser.",
  "audio-capture": "No microphone was found.",
};

export type ListeningSession = {
  stop: () => void;
  abort: () => void;
};

export function startListening(options: {
  continuous: boolean;
  onUpdate: (text: string, isFinal: boolean) => void;
  onEnd: (finalText: string) => void;
  onError: (message: string) => void;
}): ListeningSession | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = "en-US";
  recognition.continuous = options.continuous;
  recognition.interimResults = true;

  let finals = "";
  let interim = "";
  let aborted = false;

  recognition.onresult = (event) => {
    interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript ?? "";
      if (result?.isFinal) {
        finals = `${finals} ${transcript}`.trim();
      } else {
        interim = `${interim} ${transcript}`.trim();
      }
    }
    const combined = `${finals} ${interim}`.trim();
    options.onUpdate(combined, interim.length === 0);
  };

  recognition.onerror = (event) => {
    if (event.error === "aborted" || event.error === "no-speech") return;
    options.onError(ERROR_MESSAGES[event.error] ?? "Speech recognition failed.");
  };

  recognition.onend = () => {
    if (aborted) return;
    options.onEnd(`${finals} ${interim}`.trim());
  };

  try {
    recognition.start();
  } catch {
    options.onError("Speech recognition is already running.");
    return null;
  }

  return {
    stop: () => recognition.stop(),
    abort: () => {
      aborted = true;
      recognition.abort();
    },
  };
}
