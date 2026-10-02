# DEV-UI-01.3 — App shell audit (read-only step, on `main` 8a1ded1)

The audit that preceded the implementation, kept as the "before" record. Measurements come from a
read-only Playwright probe against a build of `main` on a TEST-ONLY database copy.

## Correction recorded by the reviewer

The audit reported "0 `<h1>`" on the probed pages and proposed making the top-bar title the page's
`<h1>`. That is **not** an app-wide fact: `src/components/layout/page-header.tsx` renders an `<h1>`
and is used by Clients, Products, Vendors and other pages. The shell title therefore stays a
non-H1 contextual label (D-01.3-F), and page-heading architecture is left to a later batch.
`page-header.tsx` is not touched.

## Shell before DEV-UI-01.3

```
src/app/layout.tsx (server)                       <html lang dir data-theme>, fonts, Toaster
└── src/app/(app)/layout.tsx (server)             session, locale, theme, sidebar cookies, notifications, favorites
    └── AppShell (client)                         org theme <style>, active item → title
        ├── <aside.sidebar> Sidebar (client)      NAV_GROUPS filtered inline, cookies, scroll memory
        ├── <header.topbar>                       <h3> title + org name; search, ⌘K, EN/AR dropdown, theme,
        │                                         favorites, notifications, Settings gear (all roles), account
        └── <main class="flex-1 p-7">             page
```

| Width | Sidebar | Main | Page overflow EN / AR | Shell state |
|---|---|---|---|---|
| 1440 | 240 | 1200 | 0 / 0 | fits |
| 1024 | 240 | 784 | 21 / 16 | title squeezed to 0 px; account past the edge |
| 768 | 240 | 528 | 277 / 272 | title gone; favorites, notifications, settings, account off-screen |
| 390 | 240 | 150 | 555 / 549 | every top-bar control off-screen incl. EN/AR and Log out; no mobile navigation |

Other findings that the implementation addresses:

* No skip link, no `main#id`, no `<nav>` landmark; group toggles had no `aria-controls`.
* Browser-default focus only; four triggers had `outline-none`; the active item's glow competed
  with focus.
* White sidebar (`--sidebar-bg #fff`) with a solid orange, glowing active pill; brand 800 weight,
  7.5 px tagline; 700-weight group headers; radii 5/7/9/10 px; off-scale sizes.
* Physical CSS (`border-right`, `right:`, `padding-left`) with `[dir=rtl]` compensation; panel
  icons did not mirror; the unused Drawer primitive was physical.
* Avatar fallback gradient; flag emoji in the language menu.
* Settings gear shown to Staff although `/settings/organization` redirects them.
* `/recycle-bin` showed the title "Dashboard".
* Duplicate icons: FileText (Quotations, Statements), FileCheck2 (Proforma, Compliance).
* Single-item groups repeated their header (Projects ▸ Projects, Inventory ▸ Products,
  Clients ▸ Clients).
* Command palette / record search: hand-made overlays with blur, no focus trap, focus lost to
  `<body>` on close; no search entry below 1024.
* Notifications: real feed (activity_logs, last 10, per-user read state) — logic out of scope.
* No organization switching exists (one `orgId` per user) — none invented.
