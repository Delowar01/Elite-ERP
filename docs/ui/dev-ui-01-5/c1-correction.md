# DEV-UI-01.5-C1 — Preserve saved-view rename semantics

Review verdict on C0 (`0786654`): *rejected — one small correction required*.

## The defect

C0 replaced `window.prompt` with one shared naming Dialog for Save and Rename. Its Input carried an unconditional `maxLength={60}`, which added a new 60-character limit to **Rename**.

| | Server (`saved-view-actions.ts`, unchanged) | Baseline UI | C0 UI | **C1 UI** |
|---|---|---|---|---|
| Save current view | non-empty, ≤ 60 (`saveViewAction`) | `window.prompt` | `maxLength` 60 | **`maxLength` 60** |
| Rename view | non-empty, **no maximum** (`renameViewAction`; column is `text`) | `window.prompt` (unrestricted) | `maxLength` 60 ✗ | **no `maxLength`** |

## The fix

`src/app/(app)/documents/_workspace/list-workspace-toolbar.tsx`, the naming Input only:

```tsx
maxLength={naming === "new" ? 60 : undefined}
```

Unchanged:
- `saved-view-actions.ts` is byte-identical (sha256 prefix `4e2a260f754684b0`, still pinned):
  - Save keeps its server 60-character check;
  - Rename has no length check;
  - delete, scoping and activity logging are untouched.
- Schema, DB, drizzle and migrations are untouched.
- The asymmetry between Save and Rename is deliberately left as it is; aligning them would be a business-rule decision for a separate batch.

## Verification

- **`verify:datatable`** — 67/67. New check: there is exactly one naming Input, and its maximum is `naming === "new" ? 60 : undefined`. An unconditional `maxLength={60}` is rejected. The check also reads the server file: the save path still has `trimmed.length > 60`, and `renameViewAction` has no name-length check. The file's sha256 pin is kept.
- **Static mutations** — 47/47 caught, including two new ones:
  - the C0 defect restored (`maxLength={60}` for both modes);
  - the Save limit dropped (`maxLength={undefined}`).
- **`verify-datatable-runtime`** (TEST-only DB) — 125/125. The saved-view flow now proves:
  - **Save:** the Save dialog's field has `maxLength` 60, and save → listed → current → apply still works.
  - **Rename:** Manage → Rename; the field has no maximum, and a deterministic 69-character name ("Sent invoices since May 2026 — renamed beyond the sixty-character cap") is accepted exactly as typed.
  - **After submit:** the dialog closes, which happens only when the server action succeeds. After a full page reload the 69-character view is listed with its full name and still applies its filters (3 rows, count 1).
  - **Cleanup:** the view is deleted through the existing confirmation.
- **Runtime mutations** (each with a fresh build), 7/7 caught:
  - new `dt-rename-maxlength`: the C0 defect is caught because the rename field gets `max 60` and the typed name is cut to 60;
  - the existing six: RowMenu name, numeric right, sticky, no-results, filter label, menu height.

### Runtime-suite robustness (test only, no assertion weakened)

Extending the saved-view flow exposed an intermittent failure that predates C1: the same flow had crashed in two of the C0 mutation runs.

**Cause.** The TEST database showed saved names with a lost prefix, e.g. `"w l1kp"` for `"Sent view l1kp"`. When a DropdownMenu item opens a Dialog, the closing menu briefly returns focus to its trigger after the dialog has autofocused the Input. The dialog's focus trap then pulls focus back, and keystrokes sent during that bounce are lost.

**Test fixes.**
- The test now types only after focus has stayed in the field for 300 ms (5 s cap).
- Views-menu opens retry while a previous layer is still closing.
- The test waits up to 10 s for `router.refresh()` to list a new view.
- The saved-view section reports a stuck step as a failing check instead of crashing the suite.
- Cleanup deletes the view by the name actually stored.

A user would have to type within milliseconds of choosing the menu item to notice the focus bounce. It is recorded as debt in the next section. Changing the app's focus handling is outside this correction.

## Other verification

All runs used an isolated worktree with no repository `.env` and TEST-ONLY databases (`devui010_test_only_*`, host 127.0.0.1).

- **TypeScript:** clean.
- **ESLint:** the 3 changed code files are clean.
- **`verify:static`:** exit 0.

  | Suite | Checks |
  |---|---|
  | role-matrix | 32/32 |
  | confirm-policy | 62/62 |
  | dirty-form | 66/66 |
  | skeletons | 89/89 |
  | contrast | 161/161 |
  | typography | 43/43 |
  | status-registry | 88/88 |
  | shell | 75/75 |
  | controls | 110/110 |
  | datatable | 67/67 |
  | edit-action | 59/59 |

  Also passing: store-model, provider-harness and backup-claims.
- **Full browser tier on the final code:** 45/45 suites pass.

  | Suite | Result |
  |---|---|
  | datatable-runtime | 125/125 |
  | controls-runtime | 302/302 |
  | shell-runtime | 341/341 |
  | dirty-core | 72/72 |
  | dirty-ui | 8/8 |

  color-theme and dark-theme also pass.
- **`verify-proforma-payments` flake:** during validation one tier run failed two of its UI checks. They count page text right after a redirect, without waiting, while the suite's DB assertions passed. The suite passed 3/3 when rerun alone and in every other tier run. It is unrelated to C1 and was left untouched.
- **Saved-view flow stability:**
  - `datatable-runtime` passed in every run on the final verifier, standalone and inside the full tier.
  - The flake-prone flow was re-run under the `dt-no-results` mutation 4 times plus the full 7-mutation pass: 0 saved-view failures.

## Screenshots

- The 210 list states were recaptured on C1 twice, each from a fresh build, into a temporary location. Every state, including all 16 saved-view states (Views menu, Manage saved views; EN / AR × 4 widths), is byte-identical:
  - between the two runs: 210 / 210;
  - against the committed DEV-UI-01.5 candidates: 210 / 210.
- No candidate was replaced, and the baseline and 01.1–01.4 candidates are untouched. A `maxLength` attribute has no rendering.

## Guardrails

| | G1 | G2 | G3 | G4 | G5 |
|---|---|---|---|---|---|
| C0 | 97 | 302 | 35 | 0 | 30 / 27 |
| C1 | 97 | 302 | 35 | 0 | 30 / 27 |

The guardrail counts are unchanged.

## Known debt (added by C1)

- **Dropdown → Dialog focus bounce** in the saved-views menu. The Radix DropdownMenu returns focus to its trigger on close, after the naming Dialog has already focused its Input. A typical fix is `onCloseAutoFocus={(e) => e.preventDefault()}` on the Views menu content. That is a behaviour change for a later batch; C1 only restores the length contract. **Resolved in C2** (`c2-correction.md`) with a conditional suppression — an unconditional `preventDefault` would also break the menu's ordinary focus return.
