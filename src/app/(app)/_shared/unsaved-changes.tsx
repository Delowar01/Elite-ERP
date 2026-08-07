"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";

/**
 * Unsaved-changes protection for create/edit forms.
 *
 * Deliberately separate from the sensitive-action policy: this is not about the consequence of an
 * action, it is about losing typing. It only ever fires when the form has ACTUALLY changed — dirty
 * is derived by comparing the current values against the ones the form opened with, so closing an
 * untouched form never prompts.
 */

/**
 * True once the form's meaningful values differ from the ones it opened with. Comparing against a
 * snapshot (rather than a "touched" flag) means typing a character and deleting it again leaves the
 * form clean, so the discard prompt only ever appears over real changes.
 */
export function useFormDirty(current: unknown): boolean {
  const serialized = JSON.stringify(current ?? null);
  // The baseline is captured once, on the first render, via the lazy state initializer.
  const [initial] = useState(() => serialized);
  return useMemo(() => initial !== serialized, [initial, serialized]);
}

/**
 * Warn before the tab is closed or reloaded with unsaved work. This is the only mechanism browsers
 * allow for leaving the page entirely, and they render their own wording — used by the full-page
 * document builders, which have no in-app "close the form" control to intercept.
 */
export function useLeaveWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

/**
 * The full guard for forms that DO have a close/cancel affordance (dialogs, in-place editors):
 * wrap the close handler in `guard(...)` and render `dialog`. A clean form closes immediately.
 */
export function useUnsavedChanges(locale: Locale, dirty: boolean) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);

  useLeaveWarning(dirty);

  const guard = useCallback(
    (proceed: (() => void) | string) => {
      const go = typeof proceed === "string" ? () => router.push(proceed) : proceed;
      if (!dirty) {
        go();
        return;
      }
      pendingAction.current = go;
      setAsking(true);
    },
    [dirty, router],
  );

  function discard() {
    const action = pendingAction.current;
    pendingAction.current = null;
    setAsking(false);
    action?.();
  }

  const dialog = (
    <Dialog open={asking} onOpenChange={(open) => !open && setAsking(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(locale, "Discard unsaved changes?")}</DialogTitle>
          <DialogDescription>{t(locale, "You have changes that have not been saved.")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {/* Keep Editing is the safe default and holds focus. */}
          <Button variant="ghost" onClick={() => setAsking(false)} autoFocus>
            {t(locale, "Keep Editing")}
          </Button>
          <Button variant="destructive" onClick={discard}>
            {t(locale, "Discard Changes")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { guard, dialog };
}
