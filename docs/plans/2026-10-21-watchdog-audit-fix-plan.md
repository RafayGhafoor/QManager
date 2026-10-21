# Connection Watchdog — audit fix plan (2026-10-21)

Status: **superseded** by 2026-10-21-watchdog-modular-lean-plan.md (kept as the evidence register).

## 1. Summary

Three audits merged into 56 distinct issues. The user report has two causes. The reboot figure stuck because `count_recent_reboots` only runs at daemon start and immediately before Tier 4 (`qmanager_watchcat:1449,863`), so every later `write_state` re-publishes the first value under a caption that says "Since the watchdog started". Recent Activity was empty because the card reads the RAM ring `/tmp/qmanager_events.json`, which the reboot it would describe wipes, and which `ca_change` churn evicts anyway (50 rows, shared).

The plan fixes both symptoms first. It then closes the real safety holes: the TERM trap never exits, every save restarts the daemon and loses its memory, the failover record lives in tmpfs, SIM swaps are never verified, quality decisions read a 10-minute lagging window, the watchdog fights airplane mode, and the UI cannot detect a dead daemon. A daemon → poller → UI liveness heartbeat is added. Design-level items (negative cache for the backup SIM, two-way Tier 3, a shared swap library, a multi-sample verdict) are deferred.

## 2. Findings register (deduplicated)

Severity: H = can strand, reboot or blind the device; M = wrong state or extra outage; L = hygiene.

| # | Merged IDs | Sev | Issue | Decision |
|---|---|---|---|---|
| 1 | WD-01, F2 | H | `reboots_this_hour` counted only at start and in Tier 4; stale for days | FIX NOW (A1) |
| 2 | F2-UI | M | Caption "Since the watchdog started" and red `bad` tone judged against a per-hour cap | FIX NOW (E) |
| 3 | WD-06 | M | Reboot limit uses the wall clock; a stale clock or a 1970 boot over- or under-counts | FIX NOW (A1) |
| 4 | WD-07 | M | Reboot-ledger append unchecked and unlocked; read-only `/etc` means unlimited reboots | FIX NOW (A1) |
| 5 | WD-01(assess), F6, WD-22(ring) | H | Recovery history is RAM-only, evicted by `ca_change`, erased by the reboot it explains | FIX NOW (A1 writer, C GET, E card) |
| 6 | WD-04, F1 | H | No heartbeat: a dead or hung daemon shows its last state forever (page and sidebar) | FIX NOW (A1, B, E) |
| 7 | WD-08, F-03(trap), F1c | M-H | `trap … EXIT INT TERM` has no `exit` (`:1434`); stop always ends in SIGKILL, sometimes mid-action | FIX NOW (A1) |
| 8 | WD-09, F-03, F3 | M-H | Every enabled save does `init restart` (`watchdog.sh:515`): memory lost, 30 s blind, unconfirmed swap stranded | FIX NOW (C) |
| 9 | F-03 #1-3, WD-08(2) | H | In-flight swap state is memory-only; a kill mid-sequence leaves CFUN=0 or the device on the backup SIM | FIX NOW (A2, A1 init `term_timeout`) |
| 10 | WD-24, F-02, F10 | H | Failover record kept only in tmpfs; "resume after reboot" is dead code | FIX NOW (A2) |
| 11 | F-03 #4 | M | Startup reads the slot once, before `BOOT_SETTLE`; an empty read deletes a valid record | FIX NOW (A2) |
| 12 | WD-02, F-04 | H | Quality trigger and verdict read the 60-sample (~10 min) window: false re-trigger, false failure, escalation to reboot on a healthy link, recheck ping-pong | FIX NOW (A3) |
| 13 | F-01, WD-18(Tier 2 CFUN=1) | H | `QUIMSLOT=` and `CFUN=1` results discarded; swaps and radio-on never verified | FIX NOW (A1 Tier 2, A2 swaps) |
| 14 | WD-12, F-11 | M | Aborted Tier 3 recorded as a moved slot (`original_sim_slot` set before `CFUN=0`) | FIX NOW (A2) |
| 15 | WD-11, F-05 | M-H | Revert runs before the lock check and while locked; can falsely report "reverted" | FIX NOW (A2) |
| 16 | WD-10(a), F-06(a) | M-H | `check_locked` ignores `/tmp/qmanager_sim_switch_active` (user SIM switch) | FIX NOW (A2) |
| 17 | F-06(b) | M | A manual slot change is never reconciled with the failover record | FIX NOW (A2) |
| 18 | WD-03 | H | Airplane mode (CFUN 0/4) is fought: Tier 2 turns the radio back on | FIX NOW (A1 daemon, E phase) |
| 19 | WD-05 | M | SSR hold never engages on slow ping profiles (detection lag 60-70 s > 45 s grace) | FIX NOW (A3) |
| 20 | F-07 | M | Settle floor missing after a failure-revert, dropped by LOCKED, no grace after LOCKED | FIX NOW (A2, monotonic `settle_until`) |
| 21 | WD-20, F-09 | M | No back-off after an exhausted ladder; endless radio and SIM cycling with Tier 4 off | FIX NOW (A1 hold-off; Tier-3 cap DEFER) |
| 22 | F-10 | M | `recovery_reason` overwritten; quality failovers lose their failback criterion | FIX NOW (A2) |
| 23 | F-12 | M-L | Unreadable slot skips Tier 3, which means a Tier-4 reboot | FIX NOW (A2, 3× retry) |
| 24 | F-13 | L-M | Poller SIM identity and band policy not refreshed after a watchdog swap | FIX NOW (A2) |
| 25 | WD-19, F-15 | L | Non-numeric or out-of-range UCI values accepted (`primary_recheck_interval=0` swaps every pass); a deleted key keeps its old value | FIX NOW (A1) |
| 26 | WD-13, F-16 | L | `jq --argjson` failure publishes a 0-byte state or failover file | FIX NOW (A1 state, A2 failover) |
| 27 | F7 | M | GET dies on any malformed `/tmp` blob or UCI value, so the user cannot even disable the watchdog | FIX NOW (C) |
| 28 | F8 | M-L | A rejected save leaves staged `uci set`s that a later commit applies | FIX NOW (C) |
| 29 | F11 | L | Non-boolean values for boolean fields silently accepted | FIX NOW (C) |
| 30 | F12 | L | `revert_sim` succeeds with the daemon off or no failover; banner toast ignores the result | FIX NOW (C, E) |
| 31 | F4 | M | Backup key list stale (`max_failures`; 7 keys missing) | FIX NOW (C) |
| 32 | WD-17, F5, F19 | M | Auto-disable reason lost on reboot; respawn overwrites state; wrong comment | FIX NOW (A1, C) |
| 33 | F9 | L-M | Status card shows zeros or the last run's numbers when off or not running | FIX NOW (B, E) |
| 34 | F13 | L | Uninstall and install leave watchdog flags in `/tmp` | FIX NOW (D) |
| 35 | F14, 03§2 | L | Daemon defaults to `enabled=1`; main keys never seeded (CGI seed unreachable) | FIX NOW (A1, D) |
| 36 | WD-14 | L | Frozen `cooldown_remaining` after LOCKED | FIX NOW (A1) |
| 37 | WD-15 | L | Stale `current_tier` after SSR natural recovery | FIX NOW (A1) |
| 38 | WD-16 | L | All tiers off: a pseudo-recovery every cycle | FIX NOW (A1 daemon bail); CGI/UI guard DEFER |
| 39 | WD-21 | L | PID guard trusts `kill -0` only; stale recovery flag not cleared at start; fixed `.tmp` name | FIX NOW (A1) |
| 40 | Doc drift | M | Feature doc and API reference wrong in roughly 30 places | FIX NOW (F) |
| 41 | F-08 | M | Single verdict at 90 s, no SSR or registration awareness | DEFER (design; partly eased by #12) |
| 42 | F-14 | L-M | Tower-failover daemon not always restarted; tower lock vs Tier 3 | DEFER (partly unproven) |
| 43 | WD-22(lock) | L | `append_event` unlocked across poller and daemon | DEFER (rare; poller hot path) |
| 44 | WD-18(Tier 1) | L-M | `COPS=0` overrides a manual operator choice | DEFER (unproven) |
| 45 | F16 | L | GET has commit side effects | DEFER (becomes a no-op once D seeds the section) |
| 46 | F17 | L | Three `status.json` pollers on one page | WONTFIX (correct, only redundant) |
| 47 | F18 | L | Timeline optimistic by up to one `check_interval` | DEFER |
| 48 | F-17 | L | One-way Tier 3, no negative cache; editing the backup slot during a failover inverts roles | DEFER, except a 1-line A2 guard (skip Tier 3 while failover is active) |
| 49 | F15 | L | Prometheus watchdog metrics ignore liveness | DEFER (follow-up on the age contract) |
| 50 | WD-04(blind) | M | Dead ping daemon leaves the watchdog blind, invisibly | DEFER (Health Check covers the ping daemon) |
| 51 | WD-23 | L | `q_packet_loss` float becomes 0 | WONTFIX (#12 replaces the reader) |
| 52 | WD-09(b) | L | `total_recoveries` / `last_recovery_*` reset on restart | DEFER (restarts rare after #8) |
| 53 | WD-10(b) | L | No age bound on lock sources | DEFER (unproven) |
| 54 | F-01(lib) | L | Share the verify primitive with `cellular/settings.sh` | DEFER (A2 keeps a daemon-local copy) |
| 55 | 2026-05-12 #9 | L | "Test backup SIM" dry run | DEFER |
| 56 | WD-01(b) | L | Show `unplanned` reboots in the Watchdog activity card | DEFER (the Alerts page shows them) |

Totals: 40 FIX NOW, 14 DEFER, 2 WONTFIX.

## 3. Fix batches

**Shared rules for every builder:**
- BusyBox ash only. One `local` per line. Guard all arithmetic with `case ''|*[!0-9]*)`.
- No jq regex; null-handle with `if . == null`.
- LF line endings (`.claude/check-crlf.sh`); `sh -n` must pass.
- Write `/tmp` files with `qm_atomic_write` and `/etc` files with `qm_durable_write`. Build JSON into a variable and check it is non-empty before writing.
- Never send `AT+CFUN=1,1`.
- Freeze the §8 contracts first.

**Running order:**

| Wave | Batches |
|---|---|
| 1 | A1 ‖ B ‖ C ‖ D ‖ E (file sets are disjoint) |
| 2 | A2 |
| 3 | A3 |
| 4 | F |

### A1 — daemon core and lifecycle
Files: `scripts/usr/bin/qmanager_watchcat`, `scripts/etc/init.d/qmanager_watchcat`.

1. **Test hook.** Change the last line to `[ "${WATCHCAT_NO_MAIN:-0}" = "1" ] || main "$@"`.
2. **Clock guard.** Source `schedule_guard.sh`, guarded by `-f`. Fallback stub `_qm_clock_sane`: `date +%Y` ≥ 2025, otherwise fail closed.
3. **Defaults.** `CFG_ENABLED` defaults to 0.
4. **`read_config`: `_cfg_int` / `_cfg_bool` with clamping.** An absent, empty, non-numeric or out-of-range value means the default. Ranges match the CGI:

   | Key | Range |
   |---|---|
   | `check_interval` | 5-60 |
   | `fail_threshold` | 1-20 |
   | `cooldown` | 10-300 |
   | `max_reboots_per_hour` | 1-10 |
   | `quality_consecutive` | 1-60 |
   | `ssr_grace` | 10-120 |
   | `primary_recheck_interval` | 5-1440 |
   | `backup_sim_slot` | 1, 2 or empty |

5. **`write_state`.**
   - Add `mono`, `pid`, `stale_after` and `holdoff_remaining`, and the `radio_off` state.
   - Coerce every `--argjson` input; build into a variable, then `qm_atomic_write`. Drop `STATE_TMP`.
   - `stale_after` = `3×check_interval+60` normally, 660 before a long action.
   - `do_recovery` writes `state=recovery` before the action.
6. **`count_recent_reboots`.**
   - Count numeric-epoch `tier4_escalation` rows only.
   - Sane clock: rows within `[now-3600, now+600]`. Clock not sane: rows with epoch < 2025-01-01.
   - Recount every 60 s of monotonic time at the top of the main loop. **This fixes the user's report.**
7. **Tier 4 ledger.** `wd_ledger_append_tier4` appends under the same flock as `record_planned_reboot`, trims to 20 rows, runs `sync`, then checks the row with `tail -n1`. If the row cannot be verified, auto-disable and do not reboot.
8. **`wd_auto_disable <reason>`.**
   - UCI: `enabled=0`, `auto_disabled_at`, `auto_disabled_reason`.
   - Set the flag, write a history line, `sync`.
   - `( init stop & )` so procd does not respawn it, then exit. Fix the wrong comment.
9. **Signals.**
   - `trap _wd_cleanup EXIT` and `trap _wd_on_signal INT TERM`. Exit 143, or defer the exit until the critical section ends.
   - Make main-loop sleeps interruptible (`sleep & wait`).
   - init.d: `procd_set_param term_timeout 20`; `stop_service` removes the state file.
10. **PID guard.** Check `/proc/$pid/cmdline`; clear a stale recovery flag at start.
11. **Airplane mode.**
    - `wd_cfun_now` and `wd_radio_on_verified`; Tier 2 tracks the radio-off it caused.
    - At recovery start, user CFUN 0/4 means the `radio_off` state with no action.
    - Leave `radio_off` when CFUN=1.
12. **All tiers off.** Stay in suspect with no pseudo-recovery.
13. **Hold-off after an exhausted ladder.** 5 → 10 → 20 → 40 → 60 min (monotonic); reset on any success.
14. **Small fixes.** `cooldown_remaining=0` on LOCKED, natural recovery, exhausted and success; `current_tier=0` on natural recovery.
15. **Persistent history.**
    - `/etc/qmanager/watchdog_history.ndjson`, at most 30 episode-level rows, flock'd, no per-write sync.
    - `wd_event` = `append_event` + `wd_history`, used for: recovery start, escalation, success, exhausted, Tier-4 reboot, auto-disable, SSR hold, radio-off, hold-off and SIM events.
    - Skip noisy persistence while the hold-off step is ≥ 2.

Risks: whether ash's trap/exit behaves as expected (test first); the state file now disappears on stop; one small flash write per episode.

Validation:
- Static: CRLF check, `sh -n`, bashism greps.
- Sourced-mode harness in `/tmp/wct` with stubbed `qcmd`/`uci`/init:
  - bucket fixtures, real clock → 1; 1970 → 2;
  - `chmod 444` ledger → auto-disable;
  - malformed counters → valid JSON;
  - stubbed `CFUN: 4` → `radio_off`;
  - hold-off sequence.
- On-device trap probe (`sh -c`, writes nothing).
- **Needs your OK** (watchdog enabled with every tier and quality off, so it never touches the modem):
  - stop takes under 2 s and the state file is gone;
  - `kill -STOP` → page shows "Not reporting";
  - `kill -9` → respawn.

### A2 — daemon SIM paths (after A1, same file)
1. **New paths.** Durable `/etc/qmanager/sim_failover.json`, the INFLIGHT breadcrumb `/tmp/qmanager_watchcat_inflight`, and the SIM-switch flag.
2. **`wd_read_slot`.** 3 tries of `AT+QUIMSLOT?` with rc checks.
3. **`wd_swap_slot target [phase]`.**
   - Reconcile first: return early if the live slot already equals the target.
   - Write the breadcrumb and raise the SIM-switch flag (pauses the poller).
   - Critical section `CFUN=0` → `QUIMSLOT` → `CFUN=1`, then verify radio-on and slot read-back, retrying once.
   - Replaces all four raw swap sequences.
4. **`execute_tier3`.**
   - Skip if a failover is already active.
   - Set `original_sim_slot` only after a verified swap; an abort leaves a clean state.
   - After a swap: `touch` the poller force-tier2 and policy-refresh flags; set the 90 s monotonic `settle_until`.
5. **`current_sim_slot != null` guards** in `finalize_sim_failover` and `_cooldown_handle_failure`.
6. **`finalize_sim_failover`.** Writes both the `/tmp` and `/etc` records (with `reason`) and clears INFLIGHT. Fallback, revert and failback clear both records; the recheck-return leg rewrites both.
7. **`failover_reason`.** A separate variable used by the recheck verdict, restored on resume.
8. **Revert.** Runs after the LOCKED and `radio_off` checks and only when quiescent; reconciles the live slot first.
9. **`check_locked`.** Also honours the SIM-switch flag when it is younger than 120 s.
10. **`settle_until`.** Set after every swap and survives LOCKED; on LOCKED exit, grace = `max(30, fail detection time)`; a failure-revert enters a settle.
11. **Startup reconcile, moved after `BOOT_SETTLE`.**
    - INFLIGHT first: radio on, revert an unconfirmed swap, re-arm an interrupted recheck.
    - Then the failover record (`/tmp`, else `/etc`), with up to 10 retries on an unreadable slot: resume, clear, or keep.

Risks: `QUIMSLOT?` / `CFUN?` reply formats (check read-only first); large logic diff, so review carefully.

Validation:
- Sourced-mode harness with stubbed `qcmd`:
  - swallowed `QUIMSLOT` → clean abort;
  - lost `CFUN=1` → radio restored;
  - revert while locked → deferred;
  - startup INFLIGHT fixtures for each phase;
  - only an `/etc` record → resumed;
  - unreadable slot → record kept.
- **Needs your OK and a second SIM:** one real Tier-3 test.

### A3 — quality window and SSR window (after A2, same file)
- **`read_quality_recent <since_mono>`.**
  - Window W = `clamp(120/interval, 6, 60)` probe samples newer than `quality_since`, from `/tmp/qmanager_ping_history`.
  - Minimum sample count W/2; below that, no verdict (return 2).
- **`quality_since`.** Set on outage, action, cooldown entry, swap, LOCKED/`radio_off` exit, and at start.
- **Verdicts.**
  - The quality verdict at cooldown end and the recheck verdict use recent samples only; "not enough samples" goes down the existing stale-retry path.
  - Reset the quality counter on a reachability success.
  - Remove the dead `read_quality` reader.
- **SSR window.** `ssr_grace + fail_threshold×interval_sec + 2×check_interval`; the hold length is unchanged.

Validation: fixtures for ping history and `ping.json`.

| Fixture | Expected |
|---|---|
| Outage, then good samples, `since` after the outage | No breach |
| 25 % scattered loss | Breach |
| Too few samples | Return 2 |
| Stubbed `dmesg` SSR line on the quiet profile | Hold engages |

### B — poller passthrough
File: `scripts/usr/bin/qmanager_poller`.
- `read_watchcat_state`: read `.mono` and `.stale_after`; when the state file is absent, reset every `wc_*` to defaults (disabled, zeros, nulls).
- Both composers emit `age_sec` (status mono − daemon mono, recomputed on every compose; null if either is missing) and `stale_after`.
- Run the `tools/poller-parity/` harness.

Validation: with the watchdog off, `.watchcat` shows `age_sec`/`stale_after` null; parity green; no composer errors in `logread`.

### C — CGI and config backup
Files: `scripts/www/cgi-bin/quecmanager/monitoring/watchdog.sh`, `scripts/usr/lib/qmanager/config_backup_sections.sh`.

1. **Validation.** `reject_field` runs `uci revert quecmanager`; boolean fields reject non-booleans.
2. **Hot reload.**
   - Daemon running: save only touches the reload flag.
   - Not running: enable + start.
   - Re-enabling clears the auto-disabled flag and the UCI fields.
3. **GET hardening.** Each `/tmp` blob passes `jq -e` validation with fallback `{}`; UCI numerics and booleans are coerced before `--argjson`.
4. **GET additions.** `history` (last 30 rows of the ndjson, newest first, via `fromjson?`), `auto_disabled`, `auto_disabled_at`.
5. **`revert_sim` errors.** `watchdog_not_running` and `no_failover`.
6. **Backup.** Full key list (`fail_threshold`, `quality_*`, `ssr_*`, `primary_recheck_*`); legacy `max_failures` → `fail_threshold` alias; range validation on apply; same no-restart rule as the CGI.

Validation, with the watchdog disabled:

| Case | Expected |
|---|---|
| POST with an invalid value | Rejected, `uci changes` empty |
| Non-boolean value for a boolean field | Rejected |
| `revert_sim` with the daemon off | `watchdog_not_running` |
| GET with a garbage state blob | Still succeeds |
| GET `history` against an `/etc` fixture | Correct rows (**needs your OK**) |
| Backup collect/apply in a stubbed subshell | Round trip matches |

### D — lifecycle
Files: `scripts/install.sh`, `scripts/uninstall.sh`.
- **`install.sh`.** Seed every missing main watchcat key (`enabled=0`, `check_interval=10`, `cooldown=60`, tiers 1/1/0/1, `max_reboots_per_hour=3`) and never overwrite existing values. Fix the "seeded lazily" comment.
- **`/tmp` cleanup.**
  - Install stop step: clear the reload, disabled and revert flags. Keep `sim_failover` and INFLIGHT, which the daemon reconciles.
  - Uninstall: remove all watchdog `/tmp` files, including `sim_swap_detected`.
- **Unchanged by design.**
  - The new `/etc/qmanager` files follow the existing keep/purge handling.
  - `qmanager_update` needs no change: it stops via init.d, so the TERM fix applies, and it reboots.

### E — frontend
Files: `types/modem-status.ts`, `hooks/use-watchdog-settings.ts`, `hooks/use-watchdog-indicator.ts`, `components/monitoring/watchdog/{derive.ts, recovery-activity-card.tsx, banners.tsx, watchdog.tsx}`, and `monitoring.json` + `errors.json` in all five locales. Craft goes through the Impeccable skill.

- **Types.**
  - `WatchcatState` adds `radio_off`.
  - `WatchcatStatus` adds `age_sec` and `stale_after`.
  - The settings hook exposes `history` and `autoDisabledAt`.
  - `revertSim` returns the result object.
- **`derivePhase`.** Report `not_running` when enabled and `age_sec > stale_after`. Add a `radio_off` phase with a neutral disc, its own lucide glyph, and label and blurb keys.
- **`deriveBand`.**
  - Show figures only while the daemon is live.
  - Reboots: eyebrow "Reboots this hour", caption "In the last hour"; `bad` tone only when reboots ≥ cap.
- **Activity card.** Merge watchdog-type RAM events with the persistent `history`, dedupe on `type|message` within 5 s, sort, cap; fix the empty-state copy.
- **Revert toast.** Use `resolveErrorMessage(result)`; add `watchdog_not_running` and `no_failover` to `errors.json` in all five locales.
- **Sidebar.** The indicator hides while the daemon is stale.
- **Copy.** New `not_running` blurb; the `auto_disabled` blurb shows the date.
- **Checks.**
  - i18n parity across all five locales.
  - Debug-copy grep (`/etc/`, `/tmp/`, `uci `, `AT+`).
  - `bunx tsc --noEmit` and lint on touched files.
  - Look at the page in the Browser pane.

### F — docs (after validation)
- Rewrite `docs/features/connection-watchdog.md` from §8.
- `docs/API-REFERENCE.md`: GET `history`, `auto_disabled_at`, `revert_sim` errors, `.watchcat.age_sec`/`stale_after`.
- `docs/features/config-backup-restore.md`: the key list.
- Routing lines in `docs/features/README.md` and `CLAUDE.md`.
- Mark the 2026-05-12 audit doc historical.
- `RELEASE_NOTE.md` lines (§6).

## 4. Lifecycle lockstep
| Script | Change |
|---|---|
| `install.sh` | Full watchcat key seed; `/tmp` flag cleanup on stop |
| `uninstall.sh` | Watchdog `/tmp` files; `/etc` history and failover follow keep/purge |
| `qmanager_update` | No change (verify TERM is handled within `term_timeout 20`) |
| `config_backup_sections.sh` | Full keys, legacy alias, no-restart apply; history and failover records are device state, not backed up |
| init.d | `term_timeout 20`; `stop_service` removes the state file |

## 5. Rollback
Deploy recipe:
1. Run the CRLF check.
2. Push the file to `/tmp/<name>.new`.
3. `cp` it to `<dest>.new`, `chmod`, `mv` over `<dest>`, then `sync`.
4. Check the md5 against the repo.

Keep `/tmp/<name>.bak` before each deploy.

| Batch | Rollback |
|---|---|
| A1, A2, A3 | Redeploy the previous blob, stop/restart watchcat. New `/etc` files are inert to the old code. |
| B | Redeploy the previous poller and restart it. The UI treats a missing `age_sec` as null. |
| C | Redeploy; stateless. |
| D | Revert the commits; affects the next install only. |
| E | Revert the commits and rebuild. |

Commit one atomic change per numbered item so `git revert` stays surgical.

## 6. Release-note lines (`## ✅ Improvements`)
- The watchdog's "reboots this hour" count now resets after an hour instead of staying the same for days.
- Recovery activity survives a restart, including the watchdog's own reboots, and isn't pushed out by other network events.
- The Watchdog page says when the watchdog stops reporting, instead of showing its last state forever.
- Saving a watchdog setting no longer restarts it, so a recovery or SIM failover in progress isn't lost.
- A SIM failover survives a reboot, and the watchdog checks that a SIM switch really happened and that the radio is back on.
- The watchdog no longer turns the radio back on while you're in airplane mode.
- Quality-based recovery judges only recent results, so it no longer re-triggers or escalates to a reboot after the connection has recovered.
- Config backups now include every watchdog setting.

## 7. Open questions
1. **Settings save:** hot-reload with no restart (recommended), or keep restarting?
2. **Persistent history:** a watchdog history file on flash (≤ 30 episode rows, no sync per write; recommended), or only the Tier-4 rows `crash.log` already keeps?
3. **Airplane mode:** a new "Radio off" phase (recommended), or reuse "Paused"?
4. **Exhausted-ladder hold-off:** 5 → 60 min as fixed behaviour (recommended), or a setting?
5. **On-device tests:** may the RM551E run the watchdog enabled with tiers 1-4 and quality off for the lifecycle and heartbeat tests? Is a second SIM fitted for one real Tier-3 test (toggles CFUN and swaps SIMs)?

## 8. Target architecture (basis for the rewritten feature doc)

### 8.1 State machine
States: `monitor`, `suspect`, `ssr_hold`, `recovery` (now visible during actions), `cooldown`, `locked`, `radio_off` (new), `disabled` (written before exit).

**Start:** PID guard (cmdline) → `read_config` (clamped) → `BOOT_SETTLE` 30 s (interruptible) → startup reconcile (INFLIGHT, then failover record) → `monitor`.

**Transitions:**
- **Any → `locked`:** lock file, long-running flag, live profile-apply PID, or SIM-switch flag younger than 120 s.
- **`locked` → `monitor`:** revert an unconfirmed swap, re-arm an interrupted recheck, extend `settle_until`.
- **`monitor` → `suspect`:** a failed probe streak.
- **`suspect` → `monitor`:** reachable with a zero streak; clears SSR hold, tier, cooldown and the hold-off step.

**Recovery start.** Triggered by a reachability streak ≥ `fail_threshold`, or by quality breaches reaching `quality_consecutive` on recent samples. Gates, in order:
1. No enabled tier → stay in suspect.
2. Still inside `settle_until` → stay.
3. Still inside `holdoff_until` → stay.
4. User turned the radio off → `radio_off`.
5. SSR gate → `ssr_hold`.
6. Otherwise → `recovery`.

**`recovery`:**
- Tier executed → `cooldown`.
- Tier skipped → next tier.
- No tier left → `monitor` + hold-off.

**End of cooldown**, checked in order: recheck arm, revert-settle arm, then the verdict (quality on recent samples since the action; reachability on `ping.reachable`).
- Success → `monitor`.
- Failure → Tier-3 fallback → next tier, or exhausted (`monitor` + hold-off, plus a revert settle if a fallback ran).

**Other:**
- **`radio_off` → `monitor`:** `AT+CFUN?` returns 1.
- **Reload with `enabled=0`:** `disabled`, then exit.

### 8.2 Tier ladder
| Tier | Action |
|---|---|
| 1 | `COPS=2` → `COPS=0` (long AT, ≤ 300 s) |
| 2 | `CFUN=0` → `CFUN=1`, radio verified; skipped under tower lock or long-running flag |
| 3 | Verified swap to `backup_sim_slot`; skipped with no slot, slot unreadable after 3 tries, backup = current, or failover already active; 90 s settle |
| 4 | Reboot limit → verified ledger row → `sync; reboot`; if denied → auto-disable (persisted) |

### 8.3 Timing model
- **Monotonic (`/proc/uptime`):** loop passes, SSR window, `settle_until`, `holdoff_until`, recheck clock, 60 s reboot recount, heartbeat `mono`, `quality_since`.
- **Wall clock:** only display and history timestamps, `crash.log` rows (cross-boot, guarded by `_qm_clock_sane`), `switched_at`, and the SIM-switch flag age.

| Quantity | Value |
|---|---|
| Detection latency | ≈ `fail_threshold × interval_sec` + up to 2 passes |
| SSR window | `ssr_grace + fail_threshold × interval_sec + 2 × check_interval` |
| Quality window | `clamp(120/interval, 6, 60)` probe samples newer than `quality_since`, minimum W/2 |

### 8.4 Persistence model
**`/tmp`** (tmpfs: per boot, high churn):
- heartbeat state `qmanager_watchcat.json`, removed on exit;
- the failover mirror, read by the poller and the CGI;
- the INFLIGHT breadcrumb;
- the reload, revert, disabled, recovery-active and SIM-switch flags;
- the shared RAM event ring.

**`/etc`** (UBIFS: survives reboot, rare writes, durable write or flock + `sync` on reboot paths):
- `crash.log`, the shared 20-row reboot ledger (its Tier-4 rows drive the limit);
- `watchdog_history.ndjson`, at most 30 episode rows;
- `sim_failover.json`, the durable failover record;
- UCI `quecmanager.watchcat.*`, including `auto_disabled_at` and `auto_disabled_reason`.

**Rule:** anything that must outlive the reboot it explains or decides goes to `/etc`. Per-pass data stays in `/tmp`.

### 8.5 Liveness contract
- **Daemon:** writes `{mono, pid, stale_after}` every pass and before every long action.
  - `stale_after` = `3×check_interval+60`, or 660 during actions.
  - Removes the state file on any exit; `stop_service` removes it too.
- **Poller:** holds the last-read values and recomputes `age_sec` on every compose. Resets all fields when the state file is absent.
- **UI:**
  - Phase is `not_running` iff the saved setting is enabled and either the daemon reports not running past the 60 s grace, or `age_sec > stale_after`.
  - Figures render only while the daemon is live.
  - The sidebar pill hides while the daemon is stale.

### 8.6 Settings apply model
The CGI validates every field; any reject runs `uci revert`. Otherwise it commits once and touches the reload flag (plus the ping reload flag if the cadence changed).

| Save | Effect |
|---|---|
| `enabled=1`, daemon running | Hot reload within one pass |
| `enabled=1`, not running | Enable + start |
| `enabled=0` | Stop + disable |
| Re-enabling | Also clears the auto-disabled flag and UCI fields |

Config restore follows the same rule. The daemon clamps every key; an absent key means the default.

### 8.7 SIM failover lifecycle
**Forward:**
1. Write the breadcrumb and raise the SIM-switch flag.
2. Critical section `CFUN=0` → `QUIMSLOT` → `CFUN=1` (TERM deferred; `term_timeout 20`).
3. Verify `CFUN?`, `QUIMSLOT?` and CPIN, with one retry.
4. Refresh the poller's identity and policy; set a 90 s settle.
5. Verdict:
   - Success → finalize: `/tmp` + `/etc` records with `reason`, `sim_db_add`, profile auto-apply, history.
   - Failure → verified fallback → settle → escalate.

**Revert (user):** only when quiescent → reconcile the live slot → verified swap → clear both records → settle.

**Auto-failback** (opt-in, every 5 min or more):
1. Verified swap to the primary.
2. Settle.
3. Verdict judged by `failover_reason`:
   - Healthy → clear the records.
   - Unhealthy → verified return + rewrite the records + settle.

**Startup:**
1. INFLIGHT reconcile: radio on, revert an unconfirmed swap, re-arm an interrupted recheck.
2. Record reconcile with a 3× slot read: resume, clear, or keep and retry.

### 8.8 Reboot limit (token bucket)
- **Count:** Tier-4 rows in `crash.log`.
  - Sane clock: rows within `[now-3600, now+600]`.
  - Clock not sane: rows with epoch before 2025-01-01.
- **Recount:** at start, every 60 s of monotonic time, and just before Tier 4.
- **Reboot allowed iff** count < `max_reboots_per_hour` and the flock'd append verifies after `sync`.
- **Otherwise auto-disable:** UCI + flag + history, init stop, exit.
- **UI:** `reboots_this_hour` is this same rolling count.
