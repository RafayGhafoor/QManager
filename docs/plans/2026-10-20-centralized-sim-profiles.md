# Plan: one page for Custom SIM Profiles and Connection Scenarios (RM520N port)

Status: awaiting approval (2026-10-20). Port ledger row: new **U4.11.x "Profiles + Scenarios merged page"**.

## Goal

Merge `/cellular/custom-profiles/connection-scenarios` into `/cellular/custom-profiles`, the way the RM520N fork does it (`d469a616`, `bb5c5a89`, `0ebf7929`). The result is one page in this order:

1. header
2. a hero card showing what is in force now
3. a "Today" schedule ribbon
4. saved profiles beside the scenario tiles
5. the profile wizard, opened in a dialog

The old route becomes a client-side redirect. The fork did this **frontend-only**, and so does this port, apart from one small backend addition (B1 below).

## What stays exactly as it is (target is ahead of the fork here)

- **The whole Verizon path is untouched.** These are backend files we do not edit:
  - `qmanager_profile_apply` forces CID 3 for Verizon.
  - The apply worker runs a USB-mode (ECM/RNDIS) preflight.
  - The `mpdn_rule` step writes `AT+QMAP="mpdn_rule",0,3,0,0,1`, and a non-Verizon apply reverts a stale PDP 3.
  - The back-to-back revert pair in `profile_mgr.sh` is kept. A brick risk sits behind it.
  - Deactivate reverts the Verizon MPDN rule and arms the pending-reboot flag `verizon_revert`.
  - When the SIM no longer matches, the profile auto-deactivates and writes `/tmp/qmanager_pending_reboot_verizon`.
  - IP Passthrough is locked while a Verizon profile is active.
- **The apply pipeline stays `apn → ttl_hl → mpdn_rule → imei`.** We do not port the fork's `scenario` step.
- **Schedules keep using cron** (`qmanager_profile_scenario` and `qmanager_scenario_schedule`). The fork's systemd timer and `_arm` helper are not ported, and neither is its `settings.scenario_id` bridge.
- **The manual-activate guard stays `scenario_locked_by_schedule`.** The fork's `profile_managed` guard is not ported. `scenarios/activate.sh` keeps reading the scenario config from disk.
- **The target's richer hook result types are kept** (`ProfileActionResult`, `ScenarioActionResult`, …). Fork call sites are adapted to them, never downgraded.

## Verizon rules carried into the new UI (must survive the re-author)

| Rule | Where it lives after the port |
|---|---|
| Picking Verizon opens a brick-warning AlertDialog and locks CID to 3, with helper text | The wizard's identity and network tabs |
| "Use my saved APN" does not copy the CID while Verizon is selected | The wizard's network tab |
| "MPDN locked" and "IMEI override" pills | The profile rows **and** the hero's identity tile |
| A Verizon note in the confirm dialog when activating a profile bound to another SIM | The activate dialog |
| Deactivate shows `setPendingReboot("verizon_revert")` and the deferred-reboot banner | The hero's Deactivate flow |
| The apply dialog has 4 steps, including `mpdn_rule` with its own detail line | `apply-progress-dialog.tsx` |
| The IPPT Verizon lock note links to `/cellular/custom-profiles` | No change (`useActiveProfile.isVerizonActive`) |

## Backend (one small change)

**B1.** `profiles/save.sh` has a gap. When the saved profile is the **active** one, the save writes to disk only, so a schedule edit does nothing until the next reapply.

- The fork works around this by auto-reapplying after the save. That reapply runs the APN attach cycle (the LAN drops), the MPDN step and possibly an IMEI reboot.
- Instead, after a successful save of the active profile, `save.sh` calls `scenario_install_cron` (or teardown when the schedule is now off). That only re-arms cron and snaps to the current window. No reboot, no CFUN, no MPDN.
- Network-field edits to the active profile (APN, CID, TTL/HL, IMEI) do **not** auto-reapply. The hero shows a Fact-Is-Info "Changes apply on next activation" chip and a Reapply action. The user chooses when the LAN drops.

## Frontend build (bottom-up)

- **F1. Libs and hooks**
  - Port `lib/schedule-timeline.ts` with tests. It must agree with `lib/scenario-schedule.ts`: first match wins and blocks wrap past midnight.
  - Add `SimProfilesProvider` / `ConnectionScenariosProvider` with `useShared*`, so one fetch each serves the page. Callers outside the page (band-locking, apn-settings, ttl-settings, IPPT) keep working unchanged.
  - Port `scenario-labels.ts`.
- **F2. Scenarios card merge**
  - Fold the scenarios page into an in-page `ConnectionScenariosCard`: tiles, the selected-scenario card and one Add/Edit dialog.
  - The card takes the props `openAddSignal`, `autoOpenAddDialog`, `nextFireByScenarioId` and `radioOwnedByProfile`. They are driven by `useActiveProfile` and map onto `scenario_locked_by_schedule`.
  - Scenario icons from B5.25 and stable tokens from B5.26 are kept.
- **F3. Page composition**
  - `custom-profile.tsx` becomes: header actions (New scenario, New profile), then `ActiveProfileHero` (three states, cross-fade from `lib/motion.ts`), then `ScheduleTodayCard`, then a container-query grid of saved profiles and scenarios.
  - The existing 4-tab wizard (`profile-input.tsx`) moves into `ProfileFormDialog` with an `initialTab` prop. "Edit schedule" opens the wizard on the Scenario tab.
  - The wizard's "+ Create scenario" stops navigating away and raises the in-page signal instead.
  - `shapes.ts` owns the geometry, per canon.
- **F4. Routing**
  - The old route becomes a redirect (`?create=1` → `?action=create-scenario`).
  - The page also accepts `?action=create`, which the SIM-swap banner already uses for the plain route.
  - The sidebar sub-item and its breadcrumb are removed.
  - The Band Locking scenario-gate banner gets a link to the page.
- **F5. i18n** in all five catalogs.
  - New keys cover the hero, the ribbon, the redirect label and the B1 notice.
  - Dead `scenarios.*` page keys are removed.
  - zh-TW is filled from zh-CN via OpenCC.
  - Toasts follow the toast-confirmation canon.

## Team (model tiers per standing preference)

| Who | Work |
|---|---|
| Opus (this session, orchestrator) | B1, F3 hero and page composition via Impeccable craft, review of every report against its own reads |
| Sonnet builder A | F1 (libs, providers, tests) |
| Sonnet builder B | F2 + F4 (scenarios card, redirect, sidebar). Its file set is separate from A's, so it runs in parallel |
| Sonnet builder C | F5 i18n after the UI keys settle |
| `validator` | B1 shell audit and on-device check |
| `docs-writer` | Merges `scenario-profile-binding.md` into `custom-sim-profiles.md` (or updates both), and updates CLAUDE.md routing, the ledger row and `RELEASE_NOTE.md` |

The work runs in a worktree reset onto `development-home`. Builders run in their own worktrees only where their file sets overlap.

## Validation

- **Frontend:** `bunx tsc --noEmit`, eslint on touched files, `bun test lib/`, `bun run icons:check`, i18n parity check, `next build` (static export, the redirect route prerenders).
- **B1:** CRLF check, BusyBox/POSIX and jq audit, then on-device. B1 needs **your OK** for the on-device step:
  1. Back up the file.
  2. Deploy `save.sh` (then `sync`).
  3. Save a schedule change on the active profile.
  4. Check that `crontab -l` re-arms.
  5. Restore by md5 if anything looks wrong.
- **Live UI:** activate, deactivate, scenario activate and the Verizon profile flows are writes on the shared modem. Each one needs your OK. Otherwise they are logged as a ledger live-check row, as U4.11 did before.

## Risks and rollback

- **Risk:** the large UI rewrite drops a Verizon affordance. The table above is the review checklist, and every row is checked before merge.
- **Risk:** the provider refactor breaks an outside caller. Providers are optional and the hooks fall back to their own fetch.
- **Rollback:** the work is atomic commits on a branch. B1 is one commit and can be reverted on its own.

## Out of scope (possible follow-ups)

- The fork's profile suggestions (`use-profile-suggestions`).
- The doc-only `verizon_mpdn_applied` event, which the worker never emits.
- Interplay between the MPDN rule and IPPT mode. A Verizon apply or revert may reset modem-side IPPT mode. Investigate this separately.
