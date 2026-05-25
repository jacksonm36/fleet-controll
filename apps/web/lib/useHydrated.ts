"use client";

import { useEffect, useState } from "react";

/** True after mount — use so SSR/first paint match (no browser-only APIs during SSR). */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}
