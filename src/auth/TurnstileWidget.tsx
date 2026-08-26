import { useEffect, useRef } from "react";

const SCRIPT_ID = "movie-together-turnstile";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window { turnstile?: TurnstileApi }
}

export const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? "";

export function TurnstileWidget({
  onTokenChange,
  resetKey,
}: {
  onTokenChange: (token: string | null) => void;
  resetKey: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!turnstileSiteKey || !containerRef.current) return;
    let widgetId: string | null = null;
    let cancelled = false;
    const render = () => {
      if (cancelled || widgetId || !containerRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: turnstileSiteKey,
        theme: "auto",
        size: "flexible",
        callback: (token: string) => onTokenChange(token),
        "expired-callback": () => onTokenChange(null),
        "error-callback": () => onTokenChange(null),
      });
    };
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    if (window.turnstile) render();
    else script.addEventListener("load", render);
    return () => {
      cancelled = true;
      script?.removeEventListener("load", render);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onTokenChange, resetKey]);

  if (!turnstileSiteKey) return null;
  return <div aria-label="Bot verification" className="turnstile-widget" ref={containerRef} />;
}
