"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { bootstrapSession } from "./auth";
import { useHydrated } from "./useHydrated";

/** Wait for hydration, then validate httpOnly session cookie via /api/auth/me. */
export function useSession(redirectToLogin = true) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void bootstrapSession().then((ok) => {
      if (cancelled) return;
      setAuthed(ok);
      setChecked(true);
      if (!ok && redirectToLogin) router.replace("/login");
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, redirectToLogin, router]);

  return { hydrated, checked, authed };
}
