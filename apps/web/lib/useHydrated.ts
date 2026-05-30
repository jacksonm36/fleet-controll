"use client";

import { useSyncExternalStore } from "react";

function subscribeHydrated(onStoreChange: () => void) {
  queueMicrotask(onStoreChange);
  return () => {};
}

/** True after mount — use so SSR/first paint match (no browser-only APIs during SSR). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeHydrated,
    () => true,
    () => false,
  );
}
