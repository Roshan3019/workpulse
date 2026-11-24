"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { TZ_COOKIE, todayISOIn } from "@/lib/dates";

/**
 * Keeps the app's date windows honest.
 *
 * Server-rendered pages compute "today" from the server clock (UTC on Vercel),
 * which is wrong for most of the world for part of the day. This component:
 *
 *  1. writes the browser's timezone to the `wp_tz` cookie on first visit, so
 *     every server page can compute the user's real today; and
 *  2. watches for the day rolling over (or the tab waking up the next morning)
 *     and refreshes the route, so an availability grid left open overnight
 *     moves on to the new week instead of showing yesterday's dates.
 */
export function TimeZoneSync() {
  const router = useRouter();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // 1) Tell the server which timezone to use for date windows.
    if (tz) {
      const existing = document.cookie
        .split("; ")
        .find((row) => row.startsWith(`${TZ_COOKIE}=`))
        ?.split("=")[1];
      if (existing !== encodeURIComponent(tz)) {
        document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
        /*
         * Only refresh when the *server* might actually be wrong, i.e. when it
         * had no opinion yet. The cookie is written before this render, so a
         * second visit already agrees and this never fires again — refreshing
         * unconditionally would re-run the whole page render right after a
         * correct one, which is a second of work for nothing on first load.
         */
        if (!existing) router.refresh();
      }
    }

    // 2) Roll the page over when the user's local date changes.
    const checkDay = () => {
      const today = todayISOIn(tz);
      if (handled.current === null) {
        handled.current = today;
        return;
      }
      if (handled.current !== today) {
        handled.current = today;
        router.refresh();
      }
    };

    const interval = window.setInterval(checkDay, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") checkDay();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", checkDay);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", checkDay);
    };
  }, [router]);

  return null;
}
