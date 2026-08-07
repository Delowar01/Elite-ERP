"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "./confirm-provider";

/**
 * Unsaved-changes protection, app-wide.
 *
 * A form registers its dirty state once with `useDirtyForm(snapshot)`. From then on the provider
 * guards every way out of the page:
 *
 *  - in-app links (sidebar, topbar, breadcrumbs, back-to-list, a row link in a table) are caught by
 *    ONE capture-phase click listener, so no individual link needs to know about dirty forms;
 *  - programmatic navigation goes through `useGuardedRouter()`, which asks the same question;
 *  - closing or reloading the tab uses the browser's own unload prompt, the only thing that works
 *    there, and only while something is actually unsaved.
 *
 * The question itself is the app's existing Global Confirmation System (`navigation.discardUnsaved
 * Changes`) — there is no second dialog implementation here.
 *
 * Dirty means "differs from what the form opened with": reverting an edit makes it clean again, and
 * a successful save re-baselines so the user is never asked to discard what they just saved.
 */

type Registry = {
  register: (id: string, dirty: boolean) => void;
  unregister: (id: string) => void;
  anyDirty: () => boolean;
  /** Run `proceed`, asking first if anything is unsaved. */
  guard: (proceed: () => void) => void;
};

const DirtyContext = createContext<Registry | null>(null);

export function DirtyFormProvider({ children }: { children: React.ReactNode }) {
  const confirm = useConfirm();
  const router = useRouter();
  const dirtyForms = useRef(new Map<string, boolean>());
  // Set the moment the user chooses "Discard Changes", so the navigation that follows is not asked
  // about a second time.
  const bypass = useRef(false);

  const anyDirty = useCallback(() => !bypass.current && [...dirtyForms.current.values()].some(Boolean), []);

  const guard = useCallback(
    (proceed: () => void) => {
      if (!anyDirty()) {
        proceed();
        return;
      }
      confirm({
        action: "navigation.discardUnsavedChanges",
        // NOT `navigatesOnSuccess`: this navigation is client-side, so the provider (which lives in
        // the layout) survives it. The dialog must close normally, otherwise it would sit open on
        // top of the page the user just moved to.
        onConfirm: () => {
          bypass.current = true;
          dirtyForms.current.clear();
          proceed();
        },
      });
    },
    [anyDirty, confirm],
  );

  const registry = useMemo<Registry>(
    () => ({
      register: (id, dirty) => {
        bypass.current = false;
        dirtyForms.current.set(id, dirty);
      },
      unregister: (id) => {
        dirtyForms.current.delete(id);
        if (dirtyForms.current.size === 0) bypass.current = false;
      },
      anyDirty,
      guard,
    }),
    [anyDirty, guard],
  );

  // ---- one listener for every in-app link on the page ----
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!anyDirty()) return;

      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      // Leave downloads, new tabs and external destinations alone — the unload prompt covers those.
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname + url.search === window.location.pathname + window.location.search) return;

      e.preventDefault();
      e.stopPropagation();
      guard(() => router.push(url.pathname + url.search));
    }
    // Capture phase so the guard runs before Next's own link handler.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [anyDirty, guard, router]);

  // ---- reload / tab close / leaving the site ----
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!anyDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyDirty]);

  return <DirtyContext.Provider value={registry}>{children}</DirtyContext.Provider>;
}

function useRegistry(): Registry | null {
  return useContext(DirtyContext);
}

export type DirtyForm = {
  /** True when the current values differ from the ones the form opened (or was last saved) with. */
  dirty: boolean;
  /**
   * Re-baseline to the current values. Call this immediately BEFORE submitting: server actions that
   * succeed redirect from the server and never return, so marking clean afterwards would be too
   * late and the user would be asked to discard what they just saved.
   */
  markClean: () => void;
  /** Undo the last `markClean` — call when a save comes back with an error. */
  restoreDirty: () => void;
};

/**
 * The single reusable primitive. Pass a snapshot of everything that counts as the form's content;
 * anything left out simply is not protected, so include line items, notes, terms and the rest.
 */
export function useDirtyForm(snapshot: unknown): DirtyForm {
  const serialized = JSON.stringify(snapshot ?? null);
  const [baseline, setBaseline] = useState(() => serialized);
  const previousBaseline = useRef<string | null>(null);
  const dirty = baseline !== serialized;

  const id = useId();
  const registry = useRegistry();
  useEffect(() => {
    registry?.register(id, dirty);
    return () => registry?.unregister(id);
  }, [registry, id, dirty]);

  // Both of these update the registry synchronously as well as via state. A save marks clean and,
  // on failure, marks dirty again inside the same async turn — React batches those two state updates
  // into one render where `dirty` never appears to change, so the effect above would not re-run and
  // the registry would keep whichever value was poked last. Poking both keeps it truthful.
  const markClean = useCallback(() => {
    previousBaseline.current = baseline;
    setBaseline(serialized);
    registry?.register(id, false);
  }, [baseline, serialized, registry, id]);

  const restoreDirty = useCallback(() => {
    if (previousBaseline.current === null) return;
    setBaseline(previousBaseline.current);
    previousBaseline.current = null;
    registry?.register(id, true);
  }, [registry, id]);

  return { dirty, markClean, restoreDirty };
}

/**
 * Router wrapper for navigation a form triggers itself (Cancel, "go back to the list", a redirect
 * after some other flow). Same question, same dialog. A clean form navigates immediately.
 */
export function useGuardedRouter() {
  const router = useRouter();
  const registry = useRegistry();

  return useMemo(
    () => ({
      push: (href: string) => (registry ? registry.guard(() => router.push(href)) : router.push(href)),
      replace: (href: string) => (registry ? registry.guard(() => router.replace(href)) : router.replace(href)),
      back: () => (registry ? registry.guard(() => router.back()) : router.back()),
    }),
    [router, registry],
  );
}

/**
 * The same protection for plain `<form action={…}>` screens whose fields are uncontrolled DOM
 * inputs rather than React state (Clients, Vendors, Products). Dirty is decided by serializing the
 * form's own values and comparing against the serialization taken when it mounted, so it obeys the
 * same rules: opening is clean, focusing is clean, and reverting an edit is clean again.
 *
 * Attach the returned ref to the `<form>`. Everything else — the popup, link interception, unload
 * protection — is shared with `useDirtyForm`.
 */
export function useDirtyFormFields(): { ref: (node: HTMLFormElement | null) => void; form: DirtyForm } {
  const [values, setValues] = useState<string>("");
  const formRef = useRef<HTMLFormElement | null>(null);

  const serialize = useCallback((node: HTMLFormElement) => {
    const data = new FormData(node);
    // Files carry no stable serialization; their presence alone counts as a change.
    return JSON.stringify([...data.entries()].map(([k, v]) => [k, v instanceof File ? v.name : v]));
  }, []);

  const ref = useCallback(
    (node: HTMLFormElement | null) => {
      formRef.current = node;
      if (!node) return;
      setValues(serialize(node));
      const onChange = () => setValues(serialize(node));
      node.addEventListener("input", onChange);
      node.addEventListener("change", onChange);
    },
    [serialize],
  );

  const form = useDirtyForm(values);
  return { ref, form };
}
