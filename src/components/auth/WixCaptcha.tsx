"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

const WIX_VISIBLE_CAPTCHA_SITE_KEY = "6Ld0J8IcAAAAANyrnxzrRlX1xrrdXsOmsepUYosy";
const WIX_CAPTCHA_SCRIPT = "https://www.google.com/recaptcha/enterprise.js?render=explicit";

interface RecaptchaEnterpriseApi {
  ready(callback: () => void): void;
  render(container: HTMLElement, options: {
    sitekey: string;
    size: "compact";
    theme: "dark";
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }): number;
  reset(widgetId: number): void;
}

declare global {
  interface Window {
    grecaptcha?: { enterprise?: RecaptchaEnterpriseApi };
  }
}

export function WixCaptcha({ onTokenChange, onExpired, resetKey }: { onTokenChange: (token?: string) => void; onExpired: () => void; resetKey: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<number | undefined>(undefined);
  const onTokenChangeRef = useRef(onTokenChange);
  const onExpiredRef = useRef(onExpired);
  const [scriptReady, setScriptReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => { onTokenChangeRef.current = onTokenChange; }, [onTokenChange]);
  useEffect(() => { onExpiredRef.current = onExpired; }, [onExpired]);

  useEffect(() => {
    if (!scriptReady || !containerRef.current || widgetIdRef.current !== undefined) return;
    const enterprise = window.grecaptcha?.enterprise;
    if (!enterprise) return;
    enterprise.ready(() => {
      if (!containerRef.current || widgetIdRef.current !== undefined) return;
      widgetIdRef.current = enterprise.render(containerRef.current, {
        sitekey: WIX_VISIBLE_CAPTCHA_SITE_KEY,
        size: "compact",
        theme: "dark",
        callback: (token) => onTokenChangeRef.current(token),
        "expired-callback": () => {
          onTokenChangeRef.current(undefined);
          onExpiredRef.current();
        },
        "error-callback": () => {
          onTokenChangeRef.current(undefined);
          setLoadError(true);
        },
      });
    });
  }, [scriptReady]);

  useEffect(() => {
    const enterprise = window.grecaptcha?.enterprise;
    if (enterprise && widgetIdRef.current !== undefined) {
      setLoadError(false);
      enterprise.reset(widgetIdRef.current);
      onTokenChangeRef.current(undefined);
    }
  }, [resetKey]);

  return (
    <div className="grid min-h-40 place-items-center rounded-xl border border-[var(--cz-hairline-strong)] bg-black/20 p-2" data-testid="wix-captcha">
      <Script id="wix-recaptcha-enterprise" src={WIX_CAPTCHA_SCRIPT} strategy="afterInteractive" onReady={() => window.grecaptcha?.enterprise ? setScriptReady(true) : setLoadError(true)} onError={() => setLoadError(true)} />
      <div ref={containerRef} />
      {!scriptReady && !loadError && <p className="text-xs text-[var(--cz-text-tertiary)]">Loading security check...</p>}
      {loadError && <p role="alert" className="px-3 text-center text-xs text-red-300">The security check could not load. Check content blockers or your connection, then reload this page.</p>}
    </div>
  );
}
