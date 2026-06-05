import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typing for the Web Speech API (not in lib.dom by default everywhere).
type SRConstructor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{
    0: { transcript: string };
    isFinal: boolean;
    length: number;
  }>;
}
interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

function getSR(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isVoiceDictationSupported(): boolean {
  return getSR() !== null;
}

type Options = {
  lang?: string;
  /** Called with the current partial chunk (interim) — useful for live preview. */
  onInterim?: (text: string) => void;
  /** Called every time a final segment is produced (commit it to the target). */
  onFinal: (text: string) => void;
  /** Optional error callback. */
  onError?: (err: string) => void;
};

/**
 * Hook autour de la Web Speech API.
 * - `start()` démarre l'écoute en continu
 * - `stop()` arrête proprement
 * - retombe en mode inactif si le navigateur n'est pas compatible
 */
export function useVoiceDictation({ lang = "fr-FR", onInterim, onFinal, onError }: Options) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onInterimRef = useRef(onInterim);
  const onFinalRef = useRef(onFinal);
  const onErrorRef = useRef(onError);

  useEffect(() => { onInterimRef.current = onInterim; }, [onInterim]);
  useEffect(() => { onFinalRef.current = onFinal; }, [onFinal]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    setSupported(isVoiceDictationSupported());
  }, []);

  const stop = useCallback(() => {
    const r = recRef.current;
    if (!r) return;
    try { r.stop(); } catch { /* noop */ }
  }, []);

  const start = useCallback(() => {
    const SR = getSR();
    if (!SR) {
      onErrorRef.current?.("unsupported");
      return;
    }
    // Stop any previous instance.
    if (recRef.current) {
      try { recRef.current.abort(); } catch { /* noop */ }
      recRef.current = null;
    }
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const txt = res[0]?.transcript ?? "";
        if (res.isFinal) {
          onFinalRef.current(txt);
        } else {
          interim += txt;
        }
      }
      if (interim) onInterimRef.current?.(interim);
    };
    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      onErrorRef.current?.(e.error || "error");
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err.message : "start-failed");
      setListening(false);
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => {
    return () => {
      const r = recRef.current;
      if (r) { try { r.abort(); } catch { /* noop */ } }
    };
  }, []);

  return { listening, supported, start, stop, toggle };
}
