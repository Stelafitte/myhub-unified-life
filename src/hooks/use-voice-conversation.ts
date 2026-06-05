import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceDictation } from "@/hooks/use-voice-dictation";

/**
 * Voice-conversation mode for the AI assistant.
 * - Continuous Web Speech listening
 * - Accumulates final segments into a transcript
 * - Auto-fires `onSubmit(text)` after `silenceMs` of inactivity (no new final segment)
 * - Pauses (does not auto-submit) while `isBusy` is true (the assistant is processing)
 *
 * Returns helpers to render a toggle button + live preview.
 */
export function useVoiceConversation({
  silenceMs = 1200,
  isBusy,
  onSubmit,
  onTranscript,
}: {
  silenceMs?: number;
  isBusy: boolean;
  onSubmit: (text: string) => void;
  /** Called on every interim/final segment for live preview. */
  onTranscript?: (text: string, kind: "interim" | "final") => void;
}) {
  const [active, setActive] = useState(false);
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSubmitRef = useRef(onSubmit);
  const isBusyRef = useRef(isBusy);

  useEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);
  useEffect(() => { isBusyRef.current = isBusy; }, [isBusy]);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const armSubmit = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      const text = bufferRef.current.trim();
      if (text.length >= 2 && !isBusyRef.current) {
        bufferRef.current = "";
        onSubmitRef.current(text);
      } else if (isBusyRef.current) {
        // retry once the assistant is free
        armSubmit();
      }
    }, silenceMs);
  }, [silenceMs]);

  const { listening, supported, start, stop } = useVoiceDictation({
    onInterim: (txt) => {
      onTranscript?.(bufferRef.current + " " + txt, "interim");
      // a fresh interim segment means the user is still talking → push the auto-submit back
      clearTimer();
    },
    onFinal: (txt) => {
      bufferRef.current = (bufferRef.current ? bufferRef.current + " " : "") + txt;
      onTranscript?.(bufferRef.current, "final");
      armSubmit();
    },
    onError: () => {
      clearTimer();
      setActive(false);
    },
  });

  const startConversation = useCallback(() => {
    bufferRef.current = "";
    clearTimer();
    setActive(true);
    start();
  }, [start]);

  const stopConversation = useCallback(() => {
    clearTimer();
    setActive(false);
    stop();
    bufferRef.current = "";
  }, [stop]);

  const toggle = useCallback(() => {
    if (active || listening) stopConversation();
    else startConversation();
  }, [active, listening, startConversation, stopConversation]);

  useEffect(() => () => {
    clearTimer();
    try { stop(); } catch { /* noop */ }
  }, [stop]);

  return {
    /** True while we are actively in voice-conversation mode. */
    active: active || listening,
    /** Browser supports SpeechRecognition. */
    supported,
    toggle,
    start: startConversation,
    stop: stopConversation,
  };
}
