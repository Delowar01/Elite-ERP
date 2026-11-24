# PO-07 — Live ERP security release: Team sensitive-field fix + Next.js 16.4.6 (separate from Platform Owner)

**Status: PLAN ONLY. Nothing has been branched, merged, built on the server, deployed or restarted.**
- This release changes the live ERP. Every step marked ✱ needs the owner's explicit approval at the time.
- This repository is public, so placeholders are used. `<ERP_HOST>`, `<ERP_UNIT>`, `<ERP_USER>` and `<ERP_ROOT>`
  (the deploy root, with `releases/`, `current` and `shared/`) are in the owner's private evidence.
- The Platform Owner branch is neither merged nor deployed by this release.
- **An independent workstream (owner instruction, 22 Nov 2026).** It does not wait for Option B or for the staging
  instance, and it does not include the H-1 host binding. H-1 changes nothing while unbound, and it ships with the
  Platform Owner release.
- **Readiness:** the plan is complete. The next step, N1 (branch and cherry-pick), needs the owner's go-ahead; nothing
  after it can start without that.
- **Revision needed before N3 (finding of 24 Nov 2026, PO-07):**
  - A Next.js 16.4.6 build of the Platform Owner branch needed more than 2.3 GB on this VPS and failed three times
    (`PO07_SHARED_VPS_STAGING_PLAN.md` §F.1).
  - N3's on-VPS build under `MemoryMax=1536M` is therefore unlikely to fit.
  - **Measured, 24 Nov 2026** (isolated runner, 2 CPUs; `.github/workflows/erp-security-release-measure.yml`, runs
    45478667896 and 45479330665):
    - The candidate (the fix branch plus `9b8aa85`, cherry-picked on the runner only) has the same tree,
      `211bc69abed66d0d47cf28fb79607c564f2e9223`, in both runs. TypeScript and ESLint pass.
    - With no cap, `next build` completes at a **2.8–2.9 GB peak**. **Under `MemoryMax=1536M` it is OOM-killed**
      (1.5 G), in both runs.
    - **N3 as written cannot work.** It is replaced by a verified external build: see
      `PO07_S10_S13_EXECUTION_PLAN.md` §12 for the packaging, transfer, installation and rollback requirements.
  - Until N1 is approved and that path is built and rehearsed, the release is **not ready to execute**. State on
    24 Nov 2026: `main` = `621f156`; the fix branch is unchanged; `9b8aa85` exists only on `feat/platform-owner`;
    nothing is merged or deployed.

## 1. Scope (verified in git, 21 Nov 2026)

| Item | Fact |
|---|---|
| Live code | `main` = `621f156` (equal to `origin/main`); the live release directory is that commit |
| Team fix | `fix/team-sensitive-fields-exposure` = `621f156` + `35d5dcc` (the fix) + `94f936e` (the handover doc). It touches `settings/organization/page.tsx`, `settings/team/team-panel.tsx` and two `verify/` files |
| Next.js | commit `9b8aa85`: `package.json`, `package-lock.json`, `verify/document-form-pins.json` (16.4.3 → 16.4.6). **On 16.4.3, `next build` now stops at the security-advisory gate (7 advisories)**, so `main` cannot be rebuilt or redeployed as it is |
| Schema or data | **none**: no change under `drizzle/` or `src/db/`. There is no database step and no data state to restore |
| Server layout (read-only) | releases are timestamped `<UTC>-<sha>` directories with a `current` link and a `shared/` directory (environment and logs); 7 releases are kept. The unit runs `npm start` from `current` with two drop-ins (Chromium path, PDF origin). The only untracked file in the live release is the deploy marker `.elite-release.json` (no hand edits to carry over) |

## 2. Release sequence

| Step | Action | Where | Approval |
|---|---|---|---|
| N0 | Read-only rediscovery just before the window: ERP PID and uptime, the current release, unit and drop-ins, free memory and disk, public status and headers of `<ERP_HOST>` | VPS, read-only | covered by the read-only authorization |
| N1 | Branch `release/security-2026-11` from `main` `621f156`; fast-forward to `94f936e`; `git cherry-pick 9b8aa85` as its own commit | local | ✱ (a git change) |
| N1a | On **disposable test databases only**: `npm ci`; TypeScript; ESLint; `next build` (expect exit 0 and no advisory gate); `verify:server`, `verify:static` (77/77; page-archetypes 257/257 with the recorded delta), the browser tier, the HTTP probe; the Team-payload canary (expect 0 occurrences) | local or CI | — |
| N1b | A PR to `main`; the owner reviews and merges | GitHub | ✱ owner |
| N2 | Optionally, in the same window: the ERP vhost's `X-Forwarded-For $remote_addr` (instead of `$proxy_add_x_forwarded_for`). This closes the forgeable client IP. `nginx -t`, then a graceful reload | VPS (CloudPanel vhost editor) | ✱ separate |
| N3 | Build the new release **beside** the live one: a new `releases/<UTC>-<newsha>` as `<ERP_USER>`, `npm ci`, `next build`, in a capped transient unit (`MemoryMax=1536M`, `CPUQuota=100%`, `Nice=19`). The live ERP keeps serving. Write `.elite-release.json` as previous releases do | VPS | ✱ |
| N4 | Quiet window: point `current` at the new release (an atomic `ln -sfn` and rename), then `systemctl restart <ERP_UNIT>`. **This is the only restart**: a few seconds of downtime | VPS | ✱ the window |
| N5 | Verify:<br>• the unit is active, with a new PID;<br>• loopback `GET /login` is 200, and public `<ERP_HOST>` still answers 401 with Basic Auth;<br>• owner sign-in;<br>• the Team page payload shows no sensitive fields (fictional canary, or the browser network panel with the owner's own account);<br>• a PDF download, one document create and edit;<br>• the journal has no errors for 15 minutes;<br>• memory is within the unit's `MemoryMax` | VPS and browser | — |
| N6 | Rollback (any N5 failure): point `current` back at the previous release and restart. Under a minute. No schema state. Optionally revert the merge on `main` | VPS | pre-approved as part of N4 |
| N7 | Merge `main` into `feat/platform-owner`. Both changes are already on it, so this should be trivial. Re-run the branch's verification | local | ✱ |

## 3. Stop conditions

**Stop before N4 (nothing has changed yet):**
- N1a has any failure;
- the build doesn't finish under the cap;
- the machine has less than 2.5 GiB available or less than 25 GB of free disk.

**Roll back at once (N6) after N4 if:**
- any N5 check fails;
- any other application's unit changes state.

## 4. Not included (separate items, as in the staging plan §K)

- SSH hardening;
- restricting the CloudPanel admin port;
- binding internal services to loopback;
- the Platform Owner host binding (H-1), which ships with the Platform Owner release.

Also, for the owner's attention (private evidence): the ERP's `shared/` directory holds several older environment
backups. They are protected (`0600`), but should be reviewed and retired when no longer needed.
