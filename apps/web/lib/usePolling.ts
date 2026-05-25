"use client";

import { useEffect, useRef } from "react";

/** Poll only while the tab is visible — cuts idle API load. */
export function usePolling(
  fn: () => void | Promise<void>,
  intervalMs: number,
  runImmediately = true,
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      void fnRef.current();
    };

    if (runImmediately) tick();

    const id = window.setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, runImmediately]);
}
