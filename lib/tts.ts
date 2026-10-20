export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function spokenChunks(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function speakText(
  text: string,
  handlers: {
    onStart: () => void;
    onEnd: () => void;
    onError: () => void;
  },
): () => void {
  const synthesis = window.speechSynthesis;
  synthesis.cancel();
  synthesis.getVoices();

  const chunks = spokenChunks(text);
  if (chunks.length === 0) {
    handlers.onEnd();
    return () => undefined;
  }

  let index = 0;
  let cancelled = false;
  let started = false;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer);
    handlers.onEnd();
  };

  const timer = window.setTimeout(() => {
    cancelled = true;
    synthesis.cancel();
    finish();
  }, Math.min(20000, 2500 + text.length * 70));

  const speakNext = () => {
    if (cancelled) return;
    const chunk = chunks[index];
    if (!chunk) {
      finish();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.lang = "en-US";
    utterance.rate = 0.96;
    utterance.onstart = () => {
      if (started || cancelled) return;
      started = true;
      handlers.onStart();
    };
    utterance.onend = () => {
      index += 1;
      speakNext();
    };
    utterance.onerror = () => {
      if (cancelled) return;
      handlers.onError();
    };
    synthesis.speak(utterance);
  };

  speakNext();

  return () => {
    cancelled = true;
    finished = true;
    window.clearTimeout(timer);
    synthesis.cancel();
  };
}

export function stopSpeaking(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}
