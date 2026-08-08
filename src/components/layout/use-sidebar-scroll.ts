"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Remembers how far the sidebar was scrolled.
 *
 * Lifetime is deliberately different from the other sidebar state. Which groups are collapsed is a
 * preference — it lives in a cookie (see lib/sidebar-prefs.ts) that the server reads, so the right
 * state renders on the first paint with no flash, and it survives logging out and back in. Scroll
 * position is not a preference; it is where you happened to be a moment ago. Putting it in the same
 * store with the same lifetime would mean opening the app in a new tab tomorrow and finding the nav
 * mysteriously scrolled. So it goes in sessionStorage: per tab, gone when the tab closes.
 *
 * Two details that are easy to get wrong:
 *
 *  - Restore runs in useLayoutEffect, before the browser paints. In a normal effect the sidebar
 *    paints at zero and then jumps, which is more distracting than not restoring at all.
 *  - The saved offset is clamped to what the sidebar can currently scroll. The nav is not always
 *    the same height: a group may now be collapsed, or a Staff user's restricted items are absent
 *    entirely, so yesterday's offset can exceed today's maximum.
 *
 *    Worth being precise: assigning an out-of-range value to scrollTop is ALREADY clamped by the
 *    browser, so this line changes no behaviour today and no test can make it fail — removing it
 *    was tried and nothing broke. It is kept because it states the intent at the point of use and
 *    because it stops being free the moment the restore stops being a bare scrollTop assignment
 *    (a smooth scrollTo, or restoring into a virtualised list that has not measured yet).
 */

const KEY = "sidebar_scroll";

export function useSidebarScroll(ref: RefObject<HTMLElement | null>) {
  // Guards the restore so it happens once per mount, not on every layout pass.
  const restored = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (!restored.current) {
      restored.current = true;
      let saved = 0;
      try {
        saved = Number(sessionStorage.getItem(KEY)) || 0;
      } catch {
        // Private mode or storage disabled — not remembering the offset is a fine outcome.
        saved = 0;
      }
      if (saved > 0) {
        // scrollHeight - clientHeight is the largest offset that shows content; anything beyond it
        // would be clamped by the browser anyway, but doing it here keeps what we store honest.
        const max = Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollTop = Math.min(saved, max);
      }
    }

    // Coalesce scroll writes to one per frame; the nav can emit dozens of events per gesture.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        try {
          sessionStorage.setItem(KEY, String(Math.round(el.scrollTop)));
        } catch {
          // Ignore: storage being unavailable must never break scrolling.
        }
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}
