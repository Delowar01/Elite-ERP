# DEV-UI-01.5-C2 — Saved-view dropdown → Dialog focus handoff

Review verdict on C1 (`7c5c537`): the length correction is approved; one interaction correction is required.

## The defect

*Save current view* and *Manage saved views* open Dialogs from the Views DropdownMenu. When a user activated either item:

1. the Dialog mounted and focused its control (the name Input, or the first Manage button);
2. about 100 ms later the closing menu ran Radix's default close-autofocus and sent focus to the Views trigger;
3. the Dialog's focus trap pulled focus straight back.

Keystrokes typed in that gap were lost. The TEST database had stored names with missing leading characters (`"w l1kp"` for `"Sent view l1kp"`). The prompt-based UI before 01.5 had no such gap.

### Measured (probe in the isolated TEST worktree; not committed)

A `focusin` / `focusout` recorder with `relatedTarget`, on a build with the fix neutralised:

| Handoff | Runs with a blur to the trigger | Sequence |
|---|---|---|
| Save | 4 / 4, at +101…+133 ms | Input focuses at +8 ms → `focusout` from the Input with relatedTarget = Views trigger → Input refocused |
| Manage | 3 / 3, at +7…+8 ms after the Dialog took focus | same pattern |

The trigger never logs a `focusin`: the trap reclaims focus synchronously, so only the `focusout` / `relatedTarget` reveals it. With the fix, none of the runs showed it.

## The fix (`list-workspace-toolbar.tsx` only)

```tsx
const viewsDialogHandoff = useRef(false);

<DropdownMenu onOpenChange={(open) => { if (open) viewsDialogHandoff.current = false; }}>
  …
  <DropdownMenuContent … onCloseAutoFocus={(event) => {
    if (viewsDialogHandoff.current) {
      event.preventDefault();
      viewsDialogHandoff.current = false;
    }
  }}>
    <DropdownMenuItem onSelect={() => { viewsDialogHandoff.current = true; openNaming("new"); }}>Save current view
    …
    <DropdownMenuItem onSelect={() => { viewsDialogHandoff.current = true; setManaging(true); }}>Manage saved views
```

- **Flag scope:** only the two Dialog-opening items set the flag. The next close consumes it, and every opening resets it, so it cannot leak into a later menu session.
- **Everything else keeps Radix's default:**
  - Escape → focus returns to the Views trigger;
  - an outside click closes the menu with Radix's normal handling;
  - applying a saved view → focus returns to the trigger.
- **Unchanged:**
  - the shared `src/components/ui/dropdown-menu.tsx` is byte-identical and now pinned (`f9f94b05c82b1ba2`);
  - the Export menu and every other menu keep their 01.4 behaviour;
  - the Dialog's own focus management;
  - the C1 length contract (Save ≤ 60, Rename unlimited).
- **Observed, unchanged:** when the Manage dialog closes, focus goes to `<body>`. The control that opened it (a menu item) no longer exists, so there is nothing to return to; this is the Dialog's own behaviour and the same before C2.

## Verification

All runs used an isolated worktree with no repository `.env` and TEST-ONLY databases (`devui010_test_only_*`, host 127.0.0.1).

### `verify:datatable` — 69/69

Two new checks:
- **Conditional suppression:** exactly one `onCloseAutoFocus` on the Views menu, and it prevents only `if (viewsDialogHandoff.current)` and then consumes the flag. An unconditional `onCloseAutoFocus={(e) => e.preventDefault()}` is rejected.
- **Flag sites:** only *Save current view* and *Manage saved views* set the flag. Applying a view does not (its `onSelect={() => setFilters(v.config)}` is required), and the flag resets on open.

Also:
- The existing "menu items only" check now requires the new Manage `onSelect` form exactly.
- `dropdown-menu.tsx` is added to the byte pins.
- All C1 saved-view contract checks are kept.

### Static mutations — 54 / 54 caught

The seven new mutations:
- unconditional `preventDefault`;
- the condition neutralised (`false &&`);
- the flag not consumed;
- the handoff flag set on apply;
- the reset on open removed;
- the Manage item no longer setting the flag;
- a `preventDefault` added to the shared DropdownMenu primitive.

One C0 mutation (a plain `<button>` injected into the Views menu) was re-anchored to the new Manage line.

### `verify-datatable-runtime` — 130/130

The section rebuilt for C2:

- **Escape before any handoff:** the menu opens by keyboard, Escape closes it, and focus returns to the Views trigger.
- **Save handoff:**
  - activated by keyboard;
  - the test waits only until the Dialog Input is focused, then types the full deterministic name immediately (no settling delay);
  - after a 400 ms observation window, the value is the complete name, the Input still has focus, and the log shows no focus move to the trigger and no blur out of the Dialog;
  - Save succeeds, and the view is listed under its full name and marked current.
- **No leak:** after the Save handoff, Escape on the Views menu again returns focus to the trigger.
- **Outside click:** a raw pointer click on a blank spot closes the menu with no Dialog, and the next Escape close still restores focus to the trigger.
- **Apply an existing view:** filters apply (3 rows, count 1) and focus returns to the trigger (no suppression).
- **Manage handoff:** focus moves into the Manage Dialog, and the trigger does not take it back during the observation window.
- **C1 contract still checked:** Save `maxLength` 60; the 69-character rename is accepted, persisted, listed after reload and applied; delete goes through the existing confirmation.

The C1 test workaround (waiting for focus to stay put for 300 ms before typing) is **removed**.

### Runtime mutations — 8 / 8 caught (each with a fresh build)

- **New `dt-handoff`** (the condition neutralised): **caught through real focus behaviour**, not source text.
  - Save: log `[…,"dialog:save","out:dialog:save>trigger","dialog:save"]`.
  - Manage: `[…,"dialog:manage","out:dialog:manage>trigger","dialog:manage"]`.
- **Retained:** rename-maxlength, menu-height, RowMenu name, numeric right, sticky, no-results, filter label.

A note on the first `dt-handoff` attempt: it SURVIVED because the recorder logged only `focusin`. The probe above showed that the regression appears as a `focusout` whose `relatedTarget` is the trigger. The recorder now logs `focusout` / `relatedTarget`, and the mutation is caught.

### Repeats, browser tier and static

- **Saved-view flow repeated:**
  - clean runtime 7× (2 fresh builds, 5 reusing the build) — 130/130 each time;
  - full tier ×2 — each run passed.
- **Full browser tier: 45 / 45**, including controls-runtime 302/302, shell-runtime 341/341 and datatable-runtime 130/130.
- **`verify:static`: exit 0.** Datatable 69/69, controls 110/110, shell 75/75, status-registry 88/88, typography 43/43, contrast 161/161, plus the rest.
- **TypeScript:** clean. **ESLint:** clean on the changed files.

## Screenshots

- The 210 list states were recaptured on C2 twice (each from a fresh build) into a temporary location. That includes all 16 saved-view states (Views menu, Manage saved views; EN / AR × 4 widths).
- **210 / 210 byte-identical** between the two runs, and to the committed DEV-UI-01.5 candidates.
- No candidate was replaced.

## Guardrails

G1 97 · G2 302 · G3 35 · G4 0 · G5 30 / 27 — unchanged from C0 and C1.
