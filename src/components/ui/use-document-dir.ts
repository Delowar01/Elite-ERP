"use client";

import { useSyncExternalStore } from "react";

// The document direction (<html dir>), read on the client (DEV-UI-01.4). The app mounts no Radix
// DirectionProvider, so a Radix primitive left to itself assumes LTR in Arabic — Tabs ran the arrow
// keys backwards, Select wrote dir="ltr" onto its portalled list and DropdownMenu laid its menus out
// LTR (fixed in C1). Select, Tabs and DropdownMenu pass this to their Radix root. Undefined on the
// server and during hydration (no attribute mismatch); the real value applies on the next render. The locale switch is a full navigation, so no subscription is needed.
const subscribe = () => () => {};

export function useDocumentDir(): "ltr" | "rtl" | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dir === "rtl" ? "rtl" : "ltr"),
    () => undefined,
  );
}
