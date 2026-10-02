# DEV-UI-01.4-C1 — DropdownMenu RTL + destructive hover

Review verdict on C0 (`a610cd7`): *rejected — small correction required*. Two corrections, nothing else.

## A. DropdownMenu follows the document direction

**Defect.** `dropdown-menu.tsx` exported `DropdownMenuPrimitive.Root` directly. The app mounts no
Radix `DirectionProvider`, so in Arabic every DropdownMenu ran LTR. The menu content carried
`dir="ltr"`, which meant:
* LTR layout;
* `align="end"` resolved to the physical right edge;
* a Radix Sub opened to the right;
* ArrowRight / ArrowLeft were not mirrored.

This affected the row menus and the shell's account / favorites / notifications menus.

**Fix (primitive only).**

```tsx
function DropdownMenu({ dir, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const docDir = useDocumentDir();
  return <DropdownMenuPrimitive.Root dir={dir ?? docDir} {...props} />;
}
```

* The hook is the same shared `use-document-dir.ts` that Select and Tabs use (no new hook, no
  `DirectionProvider`).
* The prop type is the installed Radix `DropdownMenuProps` (`dir?: Direction`); TypeScript verifies it.
* A caller may still pass `dir`.
* `DropdownMenuContent`, `Sub`, `SubTrigger` and `SubContent` read the direction from this root
  (Radix menu root context). No shell component was edited.

**Smallest glyph correction.** The row menu's "Convert to" entry ends in a `ChevronRight` meaning
"forward". In RTL it now mirrors (it points to the inline end) while collapsed. Expanded, it still
rotates down in both directions:

```css
[data-radix-menu-content][dir="rtl"] .row-menu-item.has-submenu:not(.expanded) svg:last-child { transform: scaleX(-1); }
```

`:dir(rtl)` was rejected: the CSS pipeline (Lightning CSS) rewrites it into a `:lang(ar, he, …)`
list, which keys on language, not direction.

## B. Destructive Button hover is a semantic colour

| | Before (C0) | After (C1) |
|---|---|---|
| `variant="destructive"` | `bg-danger text-danger-foreground hover:brightness-95` | `bg-danger text-danger-foreground hover:bg-danger-hover` |

New token `--danger-hover`:
* Declared beside `--danger` in `globals.css` as `light-dark(#992b26, #f29c96)`, registered as
  `@property <color>`, with the Tailwind alias `--color-danger-hover`.
* Canonical in `src/lib/design-tokens.ts` (`dangerHover`), the same pattern as `primaryHover`.
* Derived from `--danger`: 15% toward black in light, 15% toward white in dark. Both move away from
  the foreground, so the label gains contrast on hover.
* `verify:contrast` gained the pair "danger-foreground on danger-hover ≥ 4.5".

| Appearance | Rest | Hover | Label contrast rest → hover |
|---|---|---|---|
| light | `#b4322d` rgb(180, 50, 45) | `#992b26` rgb(153, 43, 38) | white 6.11 → 7.70 |
| dark | `#f08a83` rgb(240, 138, 131) | `#f29c96` rgb(242, 156, 150) | `#17173f` 7.04 → 8.10 |

Behaviour:
* No filter, no brightness, no gradient, no shadow / glow, no transform / lift. Geometry is unchanged
  on hover (runtime-measured).
* `destructive-ghost` keeps its tint treatment.
* No other colour token and no organisation-theme behaviour changed.

## Verification (TEST-ONLY isolation, no repository `.env`)

### Static checks
* `verify:controls`: 102 → **110** checks.
  * One direction invariant over Select, Tabs and DropdownMenu. Each must have a wrapper, the shared
    `useDocumentDir` import, `dir={dir ?? docDir}` and no raw `Root` alias.
  * No second direction hook in the primitives.
  * Destructive hover is `hover:bg-danger-hover` with no brightness / filter / hex / gradient /
    shadow / transform.
  * The `--danger-hover` token, its `@property` and its alias exist.
  * The chevron rule exists, and no `:dir()` is used.
  * The `[dir=rtl]` geometry ban stays in force; only the chevron glyph rule is allow-listed.
* **Static mutations: 13 / 13 caught.**
  * Restoring `const DropdownMenu = DropdownMenuPrimitive.Root`, `dir={dir}`, and a different hook
    import path.
  * Select `dir={docDir}`; the Tabs raw alias.
  * `hover:brightness-95`; brightness added beside the token; an arbitrary hex hover; a shadow hover.
  * The token removed (contrast fails as well); the alias removed.
  * The chevron rewritten as `:dir(rtl)`; a `[dir=rtl] .row-menu-submenu` padding override.
* `verify:static` exits 0: contrast 161/161, typography 43/43, status registry 88/88, shell 75/75,
  controls 110/110.

### Runtime checks
* `verify-controls-runtime`: 226 → **302 / 302**. New checks, EN / AR × light / dark:
  * **Destructive hover:**
    * rest colour is `--danger`, hover colour is `--danger-hover` (a real change);
    * filter, shadow and transform are `none`, and geometry is unchanged;
    * label ≥ 4.5 at rest and on hover.
  * **Real shared RowMenu:**
    * content and first item direction `ltr` / `rtl`;
    * `align="end"` aligns to the trigger's logical end (right edge EN, left edge AR) and stays
      inside the viewport;
    * the item icon sits at the inline start;
    * keyboard open focuses the first item;
    * the convert entry is reached by keyboard, its chevron mirrored in AR and unmirrored in EN;
    * Enter expands the submenu in the document direction, with its rule and indent on the inline
      start and the chevron rotated down;
    * ArrowDown enters the targets; Escape closes and returns focus.
  * **Radix Sub:**
    * the wrong-direction key does not open it;
    * ArrowRight (EN) / ArrowLeft (AR) opens it with focus inside;
    * SubContent direction is `ltr` / `rtl` and it opens to the inline end (right of the trigger EN,
      left AR), inside the viewport;
    * the opposite key closes it and returns focus to the sub trigger.
  * **Shell menus at 1440** (account, favorites, notifications; EN / AR × light / dark):
    * direction `ltr` / `rtl`;
    * `align="end"` logical;
    * inside the viewport;
    * Escape closes and returns focus.
  * **Shell menus at 390** (the same three menus, opened from the navigation drawer):
    * direction;
    * inside the viewport;
    * Escape closes the menu (the drawer stays) and returns focus.
* **Runtime mutations, each with a fresh build: 3 / 3 caught.**
  * DropdownMenu `dir={dir}`: 12 checks fail.
  * `hover:brightness-95` restored: 8 checks fail.
  * Chevron rule removed: the AR chevron checks fail.
* Two timing races were removed from harness code, not from assertions:
  * the Select ArrowDown+Enter step now waits for Radix's highlighted option;
  * the menu steps wait for focus to land in the menu before pressing keys.
* **Full browser tier: 44 / 44**, including:
  * shell-runtime 341/341, controls-runtime 302/302, favorites 20/20;
  * color-theme, dark-theme, staff-runtime;
  * dirty-core 72/72, dirty-ui 8/8, confirm-e2e 34/34.
* TypeScript clean; ESLint clean on the changed files.

### Guardrails
G1 176, G2 326, G3 44, G4 0, G5 30 / 27 — identical to C0.

## Screenshots

* **256-state matrix:** twice on C1, 256 / 256 byte-identical. It is **256 / 256 byte-identical
  to C0**, so the committed candidates are unchanged and `screenshot-change-report.json`
  (vs DEV-UI-01.3) still holds.
* **Control gallery:** 100 → **112** states (twice: 112 / 112 byte-identical).
  * The 100 C0 states are byte-identical to C0.
  * New group `menus`:
    * `menu-row-open`: the real RowMenu with "Convert to" expanded, EN / AR × light / dark ×
      1440 / 390 (8);
    * `menu-sub-open`: a Radix Sub opened with the direction's own arrow key, EN / AR × light /
      dark @1440 (4).
  * 0 non-200, 0 console errors, 0 overflow.
* **Shell evidence:** the 44 shell states, twice on C1 (44 / 44 byte-identical). Compared with C0:
  * 40 identical;
  * 4 changed — exactly the Arabic open-menu states:
    * `shell-s5-account-menu__ar__light__1440`, `…__ar__light__390`;
    * `shell-s7-notifications__ar__light__1440`, `…__ar__dark__1440`.

  The changes:
  * the account and notifications menus now lay out right-to-left;
  * they align to the trigger's left edge (the logical end in RTL);
  * the notification check-marks and unread dots are on the inline end and start.

  All English states and every closed state are unchanged. 0 non-200, no overflow increase, 0 other
  console errors. Details: `shell-regression-report.json` → `c1`.
* The gallery bundle aliases `next/link` to `tests/ui-baseline/gallery-link-stub.tsx`. The real
  RowMenu imports it but renders `Link` only for `href` entries, which the gallery does not use. The
  stub is harness only and never part of the app build.

## Known debt added by C1 (not fixed — outside the correction)

* `DropdownMenuSubContent` (exported, **no consumer in the app**) styles its floating panel with
  the inline-expansion class `row-menu-submenu`. It is visible in `controls-menu-sub-open__*`: a
  correctly placed, correctly directed list with no panel background or border. This is unchanged
  since before DEV-UI-01.4; give it the `.row-menu` panel when a consumer first needs it.
* There is still no app-wide Radix `DirectionProvider`. Select, Tabs and DropdownMenu now pass the
  direction explicitly. Popover is unaffected for layout; the SearchableSelect list was already
  measured RTL in C0.
