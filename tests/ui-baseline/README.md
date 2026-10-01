# DEV-UI-01.0 — visual baseline & static guardrails

Measurement only. **Nothing under `src/` or `drizzle/` is changed by this batch**, and nothing here
hides, masks or fixes an existing UI defect. The screenshots are today's behaviour, including what
is broken (e.g. 390px dashboards overflow by ~550px; Arabic pages log a React hydration error).

| Path | Purpose |
|---|---|
| `config.mjs` | The matrix: 16 routes × en/ar × light/dark × 1440/1024/768/390 = **256 states**; frozen instant; port. |
| `isolation.mjs` | Decides which database the baseline server may use, and refuses everything else. |
| `freeze-time.cjs` | `--require` preload for the baseline `next start` only: argument-less `new Date()` / `Date.now()` return the frozen instant. |
| `seed.mts` | Deterministic **synthetic** data (fictional names, `.test` domains). Org defaults come from the app's own `seedOrgDefaults`. |
| `run.mjs` | `prepare` · `capture` · `compare` · `check`. |
| `guardrails.mjs` | Five static, **report-only** measurements (never fails). |
| `baseline/` | The committed baseline: 256 PNGs + `manifest.json` (sha256, HTTP status, final path, `dir`, `data-theme`, horizontal overflow, loaded fonts, console errors per state). |

## Database isolation

* The only input is `UI_BASELINE_ADMIN_URL` — a **local** PostgreSQL role with `CREATEDB`. The
  repository's `DATABASE_URL` (shell or `.env`) is never used as a target or a fallback, and the run
  is refused if the baseline database would be the same database.
* Non-loopback hosts are refused. Every database touched is named `devui010_test_only_*`
  (`…_seed` = template, `…_run` = a fresh copy per capture), and carries a
  `COMMENT … TEST-ONLY` marker.
* The server process gets **every key `.env` defines** explicitly overridden (Next.js never
  overrides an already-set variable), with fresh random `AUTH_SECRET` / `FIELD_ENCRYPTION_KEYS`, the
  fake storage driver in a scratch directory, and the exchange-rate provider pointed at a closed
  local port. A key added to `.env` later that the harness does not override stops the run.
* The owner password is random per `prepare`, written only to `.ui-baseline-work/owner-password`
  (mode 0600, git-ignored). No credential is printed or committed.

## Determinism

| Source of variance | Control |
|---|---|
| Server "today" | `freeze-time.cjs`, `UI_BASELINE_FROZEN_NOW=2026-06-15T09:00:00Z`, `TZ=UTC` |
| Browser "today" | `page.clock.setFixedTime(…)`, `timezoneId: "UTC"` |
| Data | Empty database → identical serial ids; every displayed timestamp set explicitly; run DB is a fresh `TEMPLATE` copy each capture |
| Fonts | waits for `document.fonts.ready` + two animation frames; next/font files are self-hosted by the build |
| Animation | Playwright `animations: "disabled"`, `caret: "hide"`, `reducedMotion: "reduce"` — no CSS is injected into the page |
| Rendering | pinned Chromium (`/opt/pw-browsers/chromium-1194`), `deviceScaleFactor: 1`, `--force-color-profile=srgb`, `--font-render-hinting=none` |
| Build | one build per capture; `.next/BUILD_ID` must be unchanged at the end of the run |
| Theme / locale | `theme` and `locale` cookies + matching `colorScheme`; browser locale `en-US` / `ar-SA` |

## Running

```sh
export UI_BASELINE_ADMIN_URL="postgresql://<test role>:<pw>@127.0.0.1:5432/postgres"   # local, CREATEDB
node tests/ui-baseline/run.mjs prepare             # template DB + synthetic seed
node tests/ui-baseline/run.mjs check               # build, capture 256 states, compare to baseline/
node tests/ui-baseline/run.mjs compare A B         # any two capture directories
node tests/ui-baseline/guardrails.mjs              # report-only counts → docs/ui/dev-ui-01-0/guardrails-baseline.json
```

`npm run ui:baseline -- <command>` and `npm run ui:guardrails` are the same entry points.

`compare` puts every state in one of four classes, and always prints the strict ones:
`IDENTICAL` (png bytes equal), `PIXEL-IDENTICAL`, `AA-NOISE` (every differing pixel within ±8/255
and ≤500 px — software-raster anti-aliasing jitter, measured once during this batch before the
raster flags were pinned: ≤107 px, max delta 6) and `DIFFERENT` (fails). With the current flags,
two independent runs, each with its own fresh build and database copy, gave **256/256
byte-identical**. **Do not refresh `baseline/` to make a run green**: a redesign stage replaces the
baseline only together with a reviewed list of the states it intended to change.

## Known limitations

* Full-page captures render `position: sticky/fixed` chrome (the sidebar) at the viewport height,
  so on tall pages the sidebar ends partway down the image. That is a property of full-page
  capture, not of the app.
* Arabic glyphs render from the system fallback (DejaVu Sans) because the app loads no Arabic
  font — today's behaviour, and environment-dependent. A different fallback font changes Arabic
  pixels without any code change; the baseline is valid for this pinned environment.
* Guardrail detectors are heuristics with file:line evidence; a hit is a measurement of the
  pattern, not proof of a visible defect.
