"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Enrollment lives on the Agents page now. */
export default function EnrollmentPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/agents#enroll");
  }, [router]);
  return null;
}
