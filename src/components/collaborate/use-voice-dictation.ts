import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web Speech API wrapper (no external dependency).
 * Returns control + interim/final transcripts. Caller decides what to insert.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySR = any;

function getRecognitionCtor(): AnySR | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: AnySR;
    webkitSpeechRecognition?: AnySR;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceDictationOptions {
  lang?: string;
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
}

export function useVoiceDictation({
  lang = "fr-FR",
  onFinal,
  onInterim,
}: VoiceDictationOptions) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<AnySR | null>(null);

  useEffect(() => {
    setSupported(Boolean(getRecognitionCtor()));
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    if (recRef.current) {
      try {
        recRef.current.stop();
      } catch {
        // ignore
      }
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event: AnySR) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const transcript: string = r[0]?.transcript ?? "";
        if (r.isFinal) {
          onFinal(transcript);
        } else {
          interim += transcript;
        }
      }
      if (interim && onInterim) onInterim(interim);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [lang, onFinal, onInterim]);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      // ignore
    }
    setListening(false);
  }, []);

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  return { supported, listening, start, stop };
}
