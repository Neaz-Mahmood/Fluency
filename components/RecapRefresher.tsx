"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

// Polling interval: refresh every 3 seconds while feedback is pending.
const REFRESH_INTERVAL_MS = 3000;
// Maximum refresh attempts before giving up (40 attempts * 3s = 2 minutes).
const MAX_REFRESH_ATTEMPTS = 40;

export function RecapRefresher() {
  const router = useRouter();
  const attemptsRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      attemptsRef.current += 1;
      router.refresh();
      if (attemptsRef.current >= MAX_REFRESH_ATTEMPTS) {
        clearInterval(timer);
      }
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [router]);

  return null;
}
