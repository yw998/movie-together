import { useCallback, useEffect, useRef, useState } from "react";

export const TRANSIENT_MESSAGE_DURATION_MS = 3000;

export function useTransientMessage() {
  const sequence = useRef(0);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const setMessage = useCallback((message: string | null) => {
    setNotice(message ? { id: ++sequence.current, text: message } : null);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setMessage(null), TRANSIENT_MESSAGE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice, setMessage]);

  return [notice?.text ?? null, setMessage] as const;
}
