# Connection Watchdog: modular split + lean fixes (2026-10-21)

Status: **approved 2026-10-21**. Decisions: label "Reboots" + caption "In the last hour"; fixed 15 min hold-off; item 13 kept; radio-off shows as Paused with its own blurb.
Inputs: audits `01-core.md` (WD-01..24), `02-sim.md` (F-01..17), `03-surface.md` (F1..F19). Line anchors below are for the current monolith `scripts/usr/bin/qmanager_watchcat` (1715 lines, LF, md5-identical to the device).

User decisions already taken: keep every watchdog feature as-is (no default-off, no removal). The RM551E test unit is free for live tests, including reboots; Tier-3 SIM swap tests only if a second SIM is fitted.

## 1. Summary

First we split the 1715-line daemon into six sourced libraries without changing behaviour, and prove that with a recorded before/after harness. Then we land 13 small fixes, each confined to one library or file, with five builders working on separate files. The user-reported bug (reboot count stuck at 1 for days, Recent Activity blank) is fixed first: the reboot count is recounted every minute, and Recent Activity reads watchdog reboots from the reboot ledger that survives restarts. The other fixes close real failure paths: a stop that never exits, a restart on every save, no liveness signal, quality checks that read 10-minute-old samples, fighting airplane mode, unverified SIM swaps, a failover record lost on reboot, and no pause after the ladder runs out. The old plan stacked 40 fixes onto the single file; this one does about a third of that, keeps each change small, and defers everything that is not a user-facing bug with a small fix.

## 2. Target module layout

All libraries live in `scripts/usr/lib/qmanager/` (installed flat to `/usr/lib/qmanager/`).

| File | Responsibility | Public functions (Phase 1, then Phase 2 additions in *italics*) |
|---|---|---|
| `qmanager_watchcat` (main) | Header, dependency sourcing, path constants, lib loading, `main()` (PID guard, trap, startup, the loop and its state edges) | `main` |
| `wd_config.sh` | UCI read and defaults | `read_config`, `resolve_quality_thresholds` |
| `wd_state.sh` | State file, maintenance-lock check, small shared AT/radio helpers | `write_state`, `check_locked`, *`write_state_busy`, `wd_sleep`, `wd_mark_radio_down`, `wd_mark_radio_up`, `wd_cfun_now`* |
| `wd_detect.sh` | Inputs that start or hold recovery: ping read, quality window, SSR gate | `read_ping`, `read_quality`, `quality_breached`, `evaluate_quality`, `ssr_in_progress`, `ssr_hold_gate`, `ssr_hold_clear`, *`wd_quality_mark`, `wd_decide_start`* |
| `wd_tiers.sh` | Ladder: tiers 1/2/4, escalation, cooldown verdict | `tower_lock_active`, `wait_for_modem`, `execute_tier1`, `execute_tier2`, `execute_tier4`, `find_next_tier`, `do_recovery`, `_cooldown_handle_failure`, `finish_cooldown`, *`wd_cooldown_verdict`* |
| `wd_sim.sh` | Tier 3, fallback, revert, auto-failback, failover record | `execute_tier3`, `sim_failover_fallback`, `finalize_sim_failover`, `initiate_primary_recheck`, `check_revert_request`, `wd_sim_finish_recheck`, `wd_sim_resume_at_start`, `wd_sim_on_unlock`, *`wd_read_slot`, `wd_swap_slot`, `wd_failover_save`, `wd_failover_clear`* |
| `wd_ledger.sh` | Reboot count from `crash.log`, reboot history for the CGI | `count_recent_reboots`, *`wd_ledger_tick`, `wd_ledger_recent_json`* |

Naming: brief proposed `wd_quality.sh`; renamed `wd_detect.sh` because the SSR gate and `read_ping` belong with quality (all three decide whether recovery starts), and a separate SSR lib would be a seventh file for 90 lines.

### 2.1 Global ownership

The owner lib declares and initialises the global at top level (values moved verbatim from lines 121-147, 352-355, 383-384). Other libs may read any global.

| Owner | Globals |
|---|---|
| main | path constants (lines 68-81), loop temporaries `_pr_now`, `_pr_due` |
| `wd_config.sh` | all `CFG_*`, `STATUS_CACHE`, `STATUS_STALE_THRESHOLD`, `BOOT_SETTLE`, `MODEM_WAIT_TIMEOUT`, `SIM_SETTLE_SECS` |
| `wd_state.sh` | `state`, `prev_state`, `failure_counter`; *`wd_radio_down`, `_wd_sleep_pid`* |
| `wd_detect.sh` | `ping_streak_fail`, `ping_reachable`, `ping_during_recovery`, `q_avg_latency`, `q_packet_loss`, `quality_breach_counter`, `ssr_hold`, `last_ssr_detected`, `ssr_hold_started`; *`quality_since`* |
| `wd_tiers.sh` | `current_tier`, `last_recovery_time`, `last_recovery_tier`, `total_recoveries`, `cooldown_remaining`, `cooldown_stale_retries`, `recovery_reason`, `_recovery_marker_emitted`; *`holdoff_until`* |
| `wd_sim.sh` | `sim_failover_active`, `original_sim_slot`, `original_sim_iccid`, `current_sim_slot`, `revert_settle_active`, `primary_recheck_active`, `recheck_return_slot`, `recheck_interrupted`, `last_recheck_time` |
| `wd_ledger.sh` | `reboots_this_hour`; *`_rb_next`* |

Phase 1 keeps today's cross-lib **reset writes** exactly as they are (LOCKED entry/exit, natural recovery, the exhausted paths reset `current_tier`, `failure_counter`, `quality_breach_counter` and similar). They are listed in a comment block at the top of `main`. Phase 2 code may only write a new global through its owner's function.

### 2.2 Sourcing order and guard

Main keeps its current dependency block (qlog, safe_tmp, events, sim_db, conn_state; lines 29-66), then defines the path constants, then:

```sh
WD_LIB_DIR="${WD_LIB_DIR:-/usr/lib/qmanager}"   # override for the harness only
for _wd_l in wd_config wd_state wd_detect wd_ledger wd_tiers wd_sim; do
    if [ -f "$WD_LIB_DIR/$_wd_l.sh" ]; then
        . "$WD_LIB_DIR/$_wd_l.sh"
    else
        qlog_error "watchcat: missing $_wd_l.sh, refusing to start"
        echo "qmanager_watchcat: missing $WD_LIB_DIR/$_wd_l.sh" >&2
        exit 1
    fi
done
[ "$WD_CONFIG_LOADED$WD_STATE_LOADED$WD_DETECT_LOADED$WD_LEDGER_LOADED$WD_TIERS_LOADED$WD_SIM_LOADED" = "111111" ] || {
    qlog_error "watchcat: library set incomplete, refusing to start"; exit 1; }
```

- `-f` guard because BusyBox `.` on a missing file kills the shell. Each lib's last line is `WD_<NAME>_LOADED=1`, so a lib that stopped early is caught too.
- The exit happens before the PID file, trap or any AT command. The daemon never runs half-loaded. procd retries 5 times (all logged), and from item 5 on the page shows "Not reporting".
- Libs contain only function definitions and global initialisers: no top-level commands, no sourcing of other libs. Order only matters for initialisers, and none of them read another lib's globals.
- The last line becomes `[ "${WATCHCAT_NO_MAIN:-0}" = "1" ] || main "$@"`.

## 3. Phase 1: mechanical split (no behaviour change)

Builder: one Sonnet builder (single coherent file set). Validator: Opus.

### 3.1 Steps

0. **Commit 0, monolith only:** change line 1715 to the `WATCHCAT_NO_MAIN` guard. Behaviour identical. Record the harness baseline against this commit (3.2).
1. Create the six libs by **cut and paste only**, per the table below. Function bodies move byte for byte. The only allowed edits are the three block extractions marked ★: wrap an existing block in a new function and call it from the same place.
2. Main keeps its header (update the comment to list the libs), lines 29-81, the loader (2.2) and `main()`.
3. `sh -n` on every file, the CRLF check, body-diff check (3.2), harness parity, then commit as `refactor(watchdog): split daemon into wd_* libraries`.

| Current lines | Content | Goes to |
|---|---|---|
| 1-66 | header, dependency sourcing | main |
| 68-81 | path constants | main |
| 83-119 | `CFG_*` defaults and fixed constants | `wd_config.sh` |
| 121-147 | state variables | split per 2.1 |
| 153-261 | `read_config`, `resolve_quality_thresholds` | `wd_config.sh` |
| 267-310 | `write_state` | `wd_state.sh` |
| 317-334 | `check_locked` | `wd_state.sh` |
| 337-350 | `tower_lock_active` | `wd_tiers.sh` |
| 352-376 | `ping_*` initialisers, `read_ping` | `wd_detect.sh` |
| 378-488 | `q_*` initialisers, `read_quality`, `quality_breached`, `evaluate_quality` | `wd_detect.sh` |
| 489-507 | `count_recent_reboots` | `wd_ledger.sh` |
| 509-599 | SSR block | `wd_detect.sh` |
| 600-613 | `wait_for_modem` | `wd_tiers.sh` |
| 615-660 | `execute_tier1`, `execute_tier2` | `wd_tiers.sh` |
| 662-859 | `execute_tier3`, `sim_failover_fallback` | `wd_sim.sh` |
| 861-910 | `execute_tier4` | `wd_tiers.sh` |
| 912-1031 | `find_next_tier`, `do_recovery`, `_cooldown_handle_failure` | `wd_tiers.sh` |
| 1033-1131 | `finalize_sim_failover`, `initiate_primary_recheck` | `wd_sim.sh` |
| 1133-1352 | `finish_cooldown` | `wd_tiers.sh`, except ★1 |
| ★1 ≈1140-1258 | the `if [ "$primary_recheck_active" = "true" ]` arm body | `wd_sim_finish_recheck` in `wd_sim.sh`. `finish_cooldown` keeps `if [ "$primary_recheck_active" = "true" ]; then wd_sim_finish_recheck; return; fi`. Both branches of the arm already end in `return`, so this is equivalent. |
| 1358-1414 | `check_revert_request` | `wd_sim.sh` |
| 1420-1497 | `main()` startup | main, except ★2 |
| ★2 1450-1491 | failover-record resume block | `wd_sim_resume_at_start`, called from the same spot. Its `local`s were `main()` locals; they become function locals. |
| 1499-1712 | main loop | main, except ★3 |
| ★3 ≈1561-1590 | LOCKED-exit SIM blocks (unconfirmed-swap revert, interrupted-recheck re-arm) | `wd_sim_on_unlock`, called from the same spot |

### 3.2 Parity proof

A small dev-only harness, `tools/watchdog-harness/` (not installed; `tools/` is never copied by `install.sh`, same as `tools/poller-parity/`).

- **Where it runs:** BusyBox ash in WSL (`busybox sh`), not on the modem. The daemon calls absolute paths (`/etc/init.d/qmanager_tower_failover`, `profile_mgr.sh`) that must never fire on the live unit from a test. In WSL they do not exist and fail silently.
- **How it runs:** it sources the script with `WATCHCAT_NO_MAIN=1 WD_LIB_DIR=<repo libs>`, then redefines stubs as shell functions (functions beat `PATH`):
  - `qcmd`: replays a per-scenario reply table and appends each AT command to `at.log`;
  - `uci`: reads a fixture file;
  - `date`, `mono_now`: fake clock;
  - `dmesg`: fixture;
  - `qm_trusted_file`: returns 0;
  - `sleep`: advances the fake clock, applies the scenario tape for pass N (rewrites the fixture `ping.json`, history and lock files), and exits after the last pass, so the EXIT trap runs.
  - Path constants (`STATE_FILE`, `CRASH_LOG`, `SIM_FAILOVER_FILE`, …) point into a temp dir.
- **Scenarios (10):** startup with and without a failover record; T1 success; T1→T2→T3 success with finalize; T3 CPIN failure and fallback; quality trigger; SSR hold then natural recovery; LOCKED mid-cooldown with an unconfirmed swap; user revert; primary recheck healthy and unhealthy; Tier-4 bucket exhausted (auto-disable); reload with `enabled=0`.
- **Output per scenario:** `at.log`, the state file after every pass (with `timestamp` normalised), the event file, the failover file and qlog lines.
- **Gate:** monolith (commit 0) vs split. Every output must be byte-identical.
- **Body-diff check:** an awk script extracts every function's text from the monolith and from the libs; the diff must be empty except for the three ★ wrappers.
- **Static:** `sh -n` on every file, `.claude/check-crlf.sh`, bashism grep, and a check that the set of function names before and after is the same (plus the ★ names).
- **On device (granted):**
  1. Deploy the libs **before** the new main, then `sync` and check md5s.
  2. Enable watchcat with tiers 1-4 and quality off, then confirm passes run.
  3. Confirm `logread` shows no errors and the state file updates every pass.
  4. Restore UCI and `sync`.

**Rollback:** redeploy the monolith from commit 0 (the libs are inert without it), then `sync`. `git revert` the split commit.

## 4. Phase 2: lean fixes

### 4.0 Contracts (frozen by the lead before builders start)

- **State file:** adds `mono` (int, `/proc/uptime` s) and `stale_after` (int s). New `state` value `radio_off`. Everything else unchanged.
- **status.json `.watchcat`:** adds `age_sec` (int or null) and `stale_after` (int or null).
- **GET `monitoring/watchdog.sh`:** adds `recent_reboots`, epoch ints, newest first, at most 5, Tier-4 rows only, `[]` on any problem.
- **`wd_state.sh`:**
  - `write_state` writes `stale_after` = `3×CFG_CHECK_INTERVAL+60`; `write_state_busy` writes the same file with `stale_after` = 600.
  - `wd_sleep N` is an interruptible sleep.
  - `wd_mark_radio_down` / `wd_mark_radio_up` maintain the marker used by the exit cleanup.
  - `wd_cfun_now` prints `0`, `1` or `4` from `AT+CFUN?` (`+CFUN: <n>`), or empty if unreadable.
- **`wd_ledger.sh`:** `wd_ledger_recent_json <limit>` uses no daemon globals (`CRASH_LOG` defaults to `/etc/qmanager/crash.log`) and is safe to source from a CGI.
- **`wd_detect.sh`:**
  - `wd_quality_mark` sets `quality_since` to now.
  - `wd_decide_start <tiers_any 0|1> <cfun> <holdoff_left>` prints `none|holdoff|radio_off|go`. It is pure: no I/O.
- **`wd_sim.sh`:**
  - `wd_read_slot` prints the slot digit (3 tries) or empty.
  - `wd_swap_slot <target>` returns 0 only when verified.
  - `wd_failover_save <json>` writes the record; `wd_failover_clear` removes it.

Every Phase 2 shell edit follows these rules:
- BusyBox ash, one `local` per line, `case ''|*[!0-9]*)` before arithmetic.
- No jq regex.
- Build JSON into a variable and check it is non-empty before writing; `qm_atomic_write` for `/tmp`, `qm_durable_write` for `/etc`.
- Never send `AT+CFUN=1,1`.

### 4.1 Items

**1. Reboot count stays a rolling hour (the reported bug).** Builder A (daemon), E (UI).
- `wd_ledger.sh` `count_recent_reboots` (was :495-507) becomes clock-aware and checks that the epoch is numeric:
  - sane clock (`_qm_clock_sane`, sourced from `schedule_guard.sh` with an `-f` guard; fallback stub `date +%Y` ≥ 2025): count `tier4_escalation` rows with epoch ≥ now-3600;
  - clock not sane (1970 boot): count rows with epoch < 1735689600. This over-counts, which is the safe direction.
- `wd_ledger_tick` recounts when `mono_now` ≥ `_rb_next`, then sets `_rb_next` = now+60.
- Main loop calls `wd_ledger_tick` as its first statement each pass, before the reload check, so it also runs while locked or in cooldown.
- UI, `derive.ts` reboots figure (≈:268-281, plus the false comments at ≈:274-275 and :297):
  - label key `watchdog.band.reboots` → "Reboots this hour";
  - `rebootsCaption` → "In the last hour";
  - `bad` tone only when reboots ≥ cap (already true);
  - all 5 locales.
- Test: fixture `crash.log` rows at now-100 / now-3700 / 1970-era, with sane and insane clocks → 1 / 0 / counted only when insane. A harness pass at +61 s recounts.

**2. Recent Activity shows watchdog reboots.** Builder A (ledger fn), D (GET), E (UI).
- `wd_ledger_recent_json <limit>`: the same awk approach as `monitoring/alerts.sh:163-175`, filtered to `tier4_escalation`, reversed and capped. `alerts.sh` is left as it is (deduplication deferred).
- `watchdog.sh` GET: source `wd_ledger.sh` with the `-f` guard (stub returns `[]`), add `--argjson recent_reboots` and the `recent_reboots` field.
- `use-watchdog-settings.ts` exposes `recentReboots: number[]`.
- `recovery-activity-card.tsx` (`LOG_LIMIT` slice ≈:171) maps each epoch to a row with a new key `watchdog.activity.tier4Reboot` ("The watchdog restarted the modem"), drops epochs below the existing `CLOCK_PLAUSIBLE_AFTER`, merge-sorts with the RAM events and caps at `LOG_LIMIT`. No dedupe is needed: the RAM "rebooting" row is erased by the reboot it announces.
- Test: GET against a fixture `crash.log` with mixed reasons returns only Tier-4 rows, newest first; with no file it returns `[]`.

**3. Stop actually stops.** Builder A.
- Main :1434 becomes `trap '_wd_exit_cleanup' EXIT`, `trap 'exit 143' TERM` and `trap 'exit 130' INT`.
- `_wd_exit_cleanup`:
  1. kill `$_wd_sleep_pid`;
  2. if `wd_radio_down=1`, send `qcmd 'AT+CFUN=1'` (a TERM that lands between `CFUN=0` and `CFUN=1` must not leave the radio off);
  3. `rm -f` the PID file, `STATE_TMP`, `RECOVERY_FLAG` and `STATE_FILE`.
- `wd_sleep` = `sleep "$1" & _wd_sleep_pid=$!; wait "$_wd_sleep_pid"; _wd_sleep_pid=""`. It replaces the `BOOT_SETTLE` sleep (:1497) and every main-loop `sleep "$CFG_CHECK_INTERVAL"` (:1545, :1604, :1610, :1670, :1711).
- Builders B (Tier 2) and C (swap helper) wrap `CFUN=0…CFUN=1` in the mark helpers.
- init.d: add `procd_set_param term_timeout 15`, and `rm -f /tmp/qmanager_watchcat.json` in `stop_service`.
- Test, first on device with `sh -c` (writes nothing): ash runs the EXIT trap after `exit` inside a TERM trap, and `wait` is interrupted promptly. Then a harness run with a TERM to a running main shows cleanup ran and the state file is gone.

**4. Saving settings no longer restarts the daemon.** Builder D.
- `watchdog.sh:508-516`: keep `rm DISABLED_FLAG` and `init enable`. Replace `restart` with: start only if `/etc/init.d/qmanager_watchcat running` fails (the same idiom as `vpn/netbird.sh:42`). A running daemon picks the change up via the reload flag already touched at :501.
- `config_backup_sections.sh:530-540`: same rule.
- Test: with the daemon running, save → PID unchanged and `logread` shows "Config reload requested"; stopped → it starts.

**5. Liveness heartbeat.** Builder A (daemon), D (poller), E (UI).
- `write_state` (was :267-310):
  - adds `--argjson mono "$(mono_now)"` and `stale_after`;
  - coerces `CFG_ENABLED`, `CFG_QUALITY_ENABLED` and the slot values with `case` before `--argjson`;
  - writes into a variable and checks it is non-empty, then `qm_atomic_write` (closes WD-13).
- `write_state_busy` is called by B at the top of `do_recovery`'s tier dispatch, so a 3-minute Tier 3 is not reported as dead.
- Poller `read_watchcat_state` (:1747-1782) reads `.mono` and `.stale_after` as fields 10-11. When the file is absent it resets **all** `wc_*` to defaults (closes F9). Both composers (≈:2124-2137 and ≈:2370-2392) emit `age_sec` = poller mono − `wc_mono` (null if either is missing) and `stale_after`. Run `tools/poller-parity/`.
- UI:
  - `types/modem-status.ts` `WatchcatStatus` adds optional `age_sec` and `stale_after`, and `WatchcatState` adds `radio_off`;
  - `derive.ts` exports `isWatchcatLive(w)` (enabled, and not `age_sec > stale_after`);
  - `derivePhase` returns `not_running` when the daemon is not live;
  - `deriveBand` shows figures only for live phases;
  - `use-watchdog-indicator.ts` hides the pill when not live;
  - `not_running` blurb → "Enabled, but the watchdog has stopped reporting." (5 locales).
- Test: a fixture state with old `mono` → poller `age_sec` above `stale_after` → `derivePhase` gives `not_running` (unit-level check in `derive.ts` with fixtures).

**6. Quality decisions use only recent samples.** Builder B (C sets the mark after swaps).
- `read_quality` (was :385-428) keeps its name and contract (sets `q_avg_latency`, `q_packet_loss`; returns 1 when there is no signal) but reads `/tmp/qmanager_ping_history`, one RTT or `null` per line, newest last (`qmanager_ping:606,624`):
  - N = min(W, (now − `quality_since`) / `CQ_INTERVAL_SEC`), with W = clamp(120 / `CQ_INTERVAL_SEC`, 6, 60);
  - N < 3 → return 1;
  - otherwise one `tail -n N | awk` for the average of numeric values and `int(nulls×100/N)`.
  - Freshness comes from `read_ping`, which already ran this pass. In the cooldown quality arm, call `read_ping` first and take the existing stale-retry path.
  - Remove the `status.json` reader and `STATUS_CACHE` / `STATUS_STALE_THRESHOLD`.
- `wd_quality_mark` is called:
  - at startup after `BOOT_SETTLE`;
  - in the main loop whenever `ping_streak_fail > 0` (an outage, so the next trigger only sees post-outage samples: this is the false-escalation fix);
  - in `do_recovery` after an action;
  - by C after every swap;
  - on LOCKED and `radio_off` exit.
- Pure verdict `wd_cooldown_verdict <reason> <ping_ok> <reachable> <q_state 0=good 1=breach 2=nodata> <stale_retries>` → `success|extend|fail`. `finish_cooldown`'s reason-aware arms (≈:1276-1351) call it, then run the same effects as today.
- Test fixtures:

  | Fixture | Expected |
  |---|---|
  | 12 nulls then 12 good samples, mark after the outage | No breach |
  | 25 % scattered loss | Breach |
  | Fewer than 3 samples since the mark | No signal |
  | Verdict table | Every combination → expected word |

**7. Respect radio-off (airplane mode); Tier 2 never leaves the radio off.** Builder B (daemon), E (UI).
- `wd_decide_start` order:
  1. no enabled tier → `none` (also fixes WD-16's pseudo-recovery: stay in `suspect`, no counters, no flag);
  2. `holdoff_left > 0` → `holdoff`;
  3. cfun is 0 or 4 → `radio_off`;
  4. otherwise `go` (then the existing `ssr_hold_gate`, then `do_recovery`). An unreadable cfun counts as 1, so recovery is never blocked on a failed read.
- Call sites:
  - the reachability start (main ≈:1649-1673);
  - the `evaluate_quality` trigger (≈:466-484);
  - `_cooldown_handle_failure` before escalating (≈:1017). A CFUN 0/4 seen there is the user's, because Tier 2 now verifies its own radio-on.
- `radio_off` state handling, a new arm near the cooldown arm in main: each pass, `wd_cfun_now`; at 1, go to `monitor`, reset counters and call `wd_quality_mark`. Skip quality evaluation and auto-failback while in `radio_off`.
- Tier 2 (:648-658): `wd_mark_radio_down` before `CFUN=0`; after `CFUN=1` + `wait_for_modem`, if `wd_cfun_now` ≠ 1, send `AT+CFUN=1` once more and log an error if it still fails; then `wd_mark_radio_up`.
- UI: `radio_off` reuses the existing Paused phase (locked disc, glyph and label "Paused"), with one new blurb key `watchdog.phase.radio_off.blurb` = "The radio is off, so the watchdog is holding off." (5 locales).
- Test: verdict table for `wd_decide_start`. Harness with stubbed `+CFUN: 4` → `radio_off`, no `AT+CFUN=1` in `at.log`; then `+CFUN: 1` → `monitor`. Stubbed lost `CFUN=1` in Tier 2 → retry seen.

**8. Every SIM swap is verified.** Builder C.
- `wd_read_slot`: up to 3 tries 1 s apart of the existing parse (:672-673).
- `wd_swap_slot <target>`:
  1. If the live slot already equals the target, return 0 without cycling the radio.
  2. `touch /tmp/qmanager_sim_switch_active` (pauses poller AT traffic, the known cause of silent `QUIMSLOT` no-ops).
  3. Up to 2 attempts of `wd_mark_radio_down`, `CFUN=0`, 2 s, `QUIMSLOT=target`, 2 s, `CFUN=1`, `wd_mark_radio_up`, `wait_for_modem`; success = slot reads back as target and `wd_cfun_now` = 1. If CFUN ≠ 1, send `CFUN=1` again.
  4. Remove the flag.
  5. On success, `touch /tmp/qmanager_force_tier2 /tmp/qmanager_refresh_policy_band` (so the dashboard shows the new SIM; same as `cellular/settings.sh`), then `wd_quality_mark`.
- Call sites, each replacing its raw sequence:

  | Site | On verify failure |
  |---|---|
  | `execute_tier3` (:709-722) | Restart tower failover; `original_sim_slot` stays `null`; return 1 (tier skipped). Move `original_sim_slot="$current_slot"` (:691) to after the verified swap. This closes WD-12/F-11. |
  | `sim_failover_fallback` (:793-797) | Return 1, keep the failover variables, error event. |
  | `check_revert_request` | Clear the record only when the fallback returns 0. Also defer (return 1, flag kept) while `check_locked` is true or state is `locked`/`radio_off`/`ssr_hold` (closes WD-11/F-05). |
  | `initiate_primary_recheck` (:1113-1117) | Stay on backup, restart the recheck clock, no settle. |
  | Recheck return leg (in `wd_sim_finish_recheck`, was :1197-1201) | Set `current_sim_slot` from `wd_read_slot`, error event. |

- Test: harness `qcmd` stubs for a swallowed `QUIMSLOT` (slot never changes) → clean skip, no record, `CFUN=1` restored. Lost `CFUN=1` → retried. Revert while a lock file exists → deferred. Already-on-target → no AT cycle.

**9. The failover record survives a reboot.** Builder C (functions), A (one call move).
- `wd_failover_save <json>`: non-empty check, then `qm_atomic_write /tmp/qmanager_sim_failover` and `qm_durable_write /etc/qmanager/sim_failover.json`.
  - It replaces both raw writes: `finalize_sim_failover` (:1068-1076) and the recheck return (:1227-1235).
  - `wd_failover_clear` removes both files; it replaces :1164 (failback), :1383 (revert) and :1488 (stale resume).
- `wd_sim_resume_at_start` (★2):
  - If `/tmp` has no record and `/etc` has a trusted one, use it.
  - The live slot comes from `wd_read_slot`.
  - Match → resume. Mismatch → `wd_failover_clear`.
  - **Unreadable → keep both files and do not activate**. Today an empty read deletes a valid record.
- Builder A moves the call in `main()` from before `BOOT_SETTLE` to just after it, so the modem is ready when the slot is read.
- Flash writes happen only at finalize, return and clear (rare).
- Test fixtures:
  - only an `/etc` record + matching slot → resumed;
  - mismatch → both files cleared;
  - unreadable slot → files kept, inactive.

**10. Pause after the ladder runs out.** Builder B.
- `HOLDOFF_SECS=900` in `wd_config.sh` (fixed, not UCI).
- Both exhausted sites set `holdoff_until=$(( $(mono_now) + HOLDOFF_SECS ))` and append one event, "Watchcat: all recovery steps tried, pausing 15 minutes":
  - `do_recovery` :966-973;
  - `_cooldown_handle_failure` :1023-1029.
- Natural recovery and any cooldown success set `holdoff_until=0`.
- `wd_decide_start` gets `holdoff_left` and returns `holdoff`, which keeps the state in `suspect`.
- No UI change.
- Test: harness exhausted ladder → no AT commands for 900 fake seconds, then a new ladder; recovery in between clears the hold.

**11. GET never dies on bad data; backup has every key.** Builder D.
- `watchdog.sh` GET (≈:219-234):
  - each of `status_json`, `sim_failover_json`, `sim_swap_json` passes `printf '%s' "$x" | jq -e . >/dev/null 2>&1`, else falls back to its default;
  - each UCI numeric and boolean used with `--argjson` is coerced with `case` to its default.
- `reject_field` (:153-159) runs `uci -q revert quecmanager` before printing, so a rejected save leaves nothing staged for a later commit to apply (F8). One line, added because a rejected save could otherwise arm Tier 4 later.
- `config_backup_sections.sh:499` `_WATCHCAT_KEYS` becomes:
  - enabled, `fail_threshold`, `check_interval`, `cooldown`, `tier1_enabled`..`tier4_enabled`, `backup_sim_slot`, `max_reboots_per_hour`;
  - `quality_enabled`, `quality_consecutive`, `ssr_aware`, `ssr_grace`, `primary_recheck_enabled`, `primary_recheck_interval`.

  On apply, a legacy `max_failures` value maps to `fail_threshold` when the latter is absent.
- Test:
  - GET with a 0-byte state file, a garbage failover file and `cooldown=abc` still returns `success:true`;
  - a rejected POST leaves `uci changes quecmanager` empty;
  - backup collect then apply round-trips all 16 keys in a stubbed subshell.

**12. Lifecycle cleanup and seeding.** Builder D (scripts), A (daemon default).
- `install.sh` watchcat block (≈:1170-1250):
  - seed every missing main key without overwriting: `enabled=0`, `check_interval=10`, `cooldown=60`, `tier1..4_enabled=1/1/0/1`, `max_reboots_per_hour=3`;
  - fix the "seeded lazily" comment.
- `uninstall.sh` (/tmp flag list ≈:532-560): add `/tmp/qmanager_watchcat_reload`, `_watchcat_disabled`, `_watchcat_revert_sim`, `/tmp/qmanager_sim_failover` and `/tmp/qmanager_sim_swap_detected`.
- `wd_config.sh`: `CFG_ENABLED` defaults to 0 for an absent key (was :79, :155).
- Test: on a fresh seed, `uci show quecmanager.watchcat` has every key; re-running install preserves edited values; uninstall dry list includes the files.

**13. (Added) SSR hold engages on slow ping profiles.** Builder B.
- `ssr_in_progress` (:550): the window becomes `CFG_SSR_GRACE + CFG_FAIL_THRESHOLD × CQ_INTERVAL_SEC + 2 × CFG_CHECK_INTERVAL`. The hold length is unchanged.
- Why add it: the test unit runs the `quiet` profile, where the 45 s window always expires before detection (60-70 s). The hold never engages and the watchdog amplifies every SSR, which this unit has about twice per session. One line.
- Test: a `dmesg` fixture with a crash 65 s ago, quiet profile → hold engages.

### 4.2 Waves (grouped by builder so no two builders touch the same file)

| Wave | Builder (Sonnet 5.5 high) | Files | Items |
|---|---|---|---|
| 0 | Lead | §4.0 contracts | freeze |
| 1 | A: daemon core | `qmanager_watchcat`, `wd_state.sh`, `wd_config.sh`, `wd_ledger.sh`, `etc/init.d/qmanager_watchcat` | 1 (daemon), 2 (ledger fn), 3, 5 (daemon), 9 (call move), 10 (constant only), 12 (default) |
| 1 | D: surface backend | `monitoring/watchdog.sh`, `config_backup_sections.sh`, `qmanager_poller`, `install.sh`, `uninstall.sh` | 2 (GET), 4, 5 (poller), 11, 12 |
| 1 | E: frontend | `types/modem-status.ts`, `hooks/use-watchdog-settings.ts`, `hooks/use-watchdog-indicator.ts`, `components/monitoring/watchdog/{derive.ts, recovery-activity-card.tsx}`, `monitoring.json` ×5 | 1, 2, 5, 7 (UI) |
| 2 | B: recovery | `wd_detect.sh`, `wd_tiers.sh`, named main-loop sites (reachability start, `radio_off` arm, `wd_quality_mark` calls) | 6, 7, 10, 13 |
| 2 | C: SIM | `wd_sim.sh` | 8, 9 |

- Wave 2 waits for Wave 1's A, because B and C call A's helpers.
- B is the only Wave-2 builder allowed in the main file. C needs no main edits.
- Opus medium reviews B and C's diffs (the recovery and SIM logic is the sensitive part).
- The lead merges each wave, runs the harness and static gates, then dispatches the next wave.
- Commits: one per item per file set (`fix(watchdog): …`), so each `git revert` stays small.

### 4.3 Where decision/effect separation pays now
- `wd_decide_start` (item 7): one ordered gate list replaces three slightly different start sites, and the order is testable as a table.
- `wd_cooldown_verdict` (item 6): the verdict changes meaning with the new quality window, and the table proves every reason × data-state combination.
- `count_recent_reboots` is already almost pure (awk over a file and `now`).
- Not now: tier executors and the SIM arms. They are mostly AT effects, and the harness's `qcmd` log already tests them.

## 5. Phase 3: docs and release notes (docs-writer, after validation)

- Rewrite `docs/features/connection-watchdog.md` around the modular layout:
  - lib table and ownership (2.1);
  - loader guard;
  - state list incl. `radio_off`;
  - heartbeat contract;
  - quality window;
  - reboot ledger rule incl. the 1970 behaviour;
  - verified swap;
  - `/etc` failover record;
  - hold-off;
  - no restart on save;
  - harness usage.

  Fix the drift items in `01-core.md` §4, `02-sim.md` §4 and `03-surface.md` §5.
- `docs/API-REFERENCE.md`: GET `recent_reboots`; `.watchcat.age_sec`/`stale_after`; replace the stale GET sample (≈:1179-1203); document `revert_sim`/`dismiss_sim_swap` and the `invalid_field {field, reason}` envelope.
- `docs/features/config-backup-restore.md`: watchdog key list and the legacy alias.
- `CLAUDE.md` and `docs/features/README.md` routing line for `connection-watchdog.md`: add `wd_*.sh` and `tools/watchdog-harness/`. Mark `docs/2026-05-12-watchdog-sim-failover-audit-fixes.md` historical.
- `RELEASE_NOTE.md` `## ✅ Improvements` (reported bug first):
  - The watchdog's "reboots this hour" count now drops back after an hour instead of staying the same for days.
  - Recent Activity now lists the watchdog's own modem restarts, even after the restart.
  - The Watchdog page now shows "Not reporting" when the watchdog stops responding.
  - Saving watchdog settings no longer restarts it, so a recovery in progress isn't lost.
  - The watchdog checks that each SIM switch really happened, and a SIM failover survives a reboot.
  - The watchdog leaves the radio off when you turn it off, and pauses after trying every recovery step.
  - Quality-based recovery judges only recent results, so it no longer escalates to a reboot after an outage has ended.
  - Recovery holds off during the modem's own quick baseband restarts on slower check profiles too.
  - Config backups now include every watchdog setting.

## 6. Lifecycle lockstep

| Path | Status |
|---|---|
| New libs | `install.sh:1505-1507` `install_dir_flat` copies every file in `scripts/usr/lib/qmanager/`. The legacy-lib sweep (≈:1858-1866) deletes only files missing from the source, so the `wd_*.sh` files are kept. Verified in code. |
| Update | `qmanager_update:140` runs `sh install.sh --skip-packages --no-reboot`, so the same copy applies. It already stops watchcat via init.d (item 3 makes that clean). |
| Uninstall | Removes the whole `/usr/lib/qmanager` tree (`uninstall.sh:20`). The new `/etc/qmanager/sim_failover.json` follows the existing keep-config/purge choice for `/etc/qmanager`, which is correct: the modem keeps its slot across a reinstall. |
| `/tmp` | Item 12 adds the five missing files to uninstall. Install leaves them (the daemon reconciles them). |
| UCI | Item 12 seeds all keys. No new UCI keys. |
| Config backup | Item 11 key list. The failover record and `crash.log` are device state and are not backed up. |
| init.d | `term_timeout 15`; `stop_service` also removes the state file. |
| Device deploy order | Libs, then main, then `sync`, then md5 check against the repo. Main without its libs refuses to start (2.2), which is safe but leaves the watchdog off. |

## 7. Validation and rollback

### Gate 1: synthetic (always first)
- `tools/watchdog-harness/` (WSL `busybox sh`): the Phase 1 parity set, plus each item's fixtures above. Run the full set after every wave.
- Pure-function tables for `wd_decide_start`, `wd_cooldown_verdict` and `count_recent_reboots`.

### Gate 2: static
- Shell:
  - `sh -n`;
  - `.claude/check-crlf.sh`;
  - bashism grep (`[[`, `==`, `local a b`, arrays, `echo -e`);
  - jq-regex grep (`test(`, `match(`, `sub(`, `gsub(`);
  - numeric guards before arithmetic;
  - no `CFUN=1,1`.
- Poller: `tools/poller-parity/`.
- Frontend: `bunx tsc --noEmit`, lint on touched files, i18n parity across the five locales, debug-copy grep of the diff (`/etc/`, `/tmp/`, `uci `, `AT+`, `read back`, `saved to`), `bun run icons:check` if a glyph changes.
- After two failed validation rounds on one item, stop and ask.

### Gate 3: live on the RM551E (granted by the user)
Before the tests, snapshot `uci show quecmanager.watchcat`, `quecmanager.ping_profile` and `crash.log` to `/tmp`. After every test, restore them and `sync`. Send AT commands only through the modem bridge, never inside an HTTP request. Never send `AT+CFUN=1,1`.

| # | Test | Pass condition |
|---|---|---|
| L1 | Phase-1 smoke: enable, tiers 1-4 and quality off | Passes run, state updates every `check_interval`, no `logread` errors |
| L2 | `time /etc/init.d/qmanager_watchcat stop` (item 3) | < 2 s, state and PID files gone, no SIGKILL |
| L3 | `kill -STOP` daemon (item 5) | Page shows "Not reporting" after `stale_after`, sidebar pill hidden; `kill -CONT` restores; `kill -9` → procd respawn |
| L4 | Save a setting while running (item 4) | PID unchanged, reload logged |
| L5 | `AT+CFUN=4` with tiers 1-2 on, low `fail_threshold` (item 7) | State `radio_off`, page shows "Paused" with the radio blurb, no CFUN from the watchdog; `AT+CFUN=1` → `monitor` |
| L6 | Real Tier 4 (items 1, 2): tiers 1-3 off, Tier 4 on, `max_reboots_per_hour=1`, ping targets pointed at TEST-NET (192.0.2.1 / 198.51.100.1; lead confirms the UCI key names in `connection-quality.md`) | Modem reboots; after boot `crash.log` has the row, `.watchcat.reboots_this_hour=1`, Recent Activity shows the restart. The next ladder auto-disables (cap). Decay: rewrite that row's epoch to now-3590 → count drops to 0 within about 70 s. Restore targets, UCI and `crash.log`, `sync`. |
| L7 | Tier 3, **only if a second SIM is fitted** (user confirms physically; read-only `AT+QUIMSLOT?` first) | Verified swap; record in `/tmp` and `/etc`; reboot → resumed; UI revert → verified back |
| L7b | No second SIM: `backup_sim_slot` = the empty slot | Swap fails verification or CPIN, verified fallback to the original slot, no record, radio on |

### Rollback per phase
- **Phase 1:** redeploy the commit-0 monolith, then `sync`; revert the split commit.
- **Phase 2 daemon items:** redeploy the previous lib set and main together.
  - The new `/etc/qmanager/sim_failover.json` is ignored by old code.
  - The new state fields are ignored by the old poller.
- **Poller:** redeploy the previous file; the UI treats a missing `age_sec` as live (optional field).
- **CGI, backup, install, uninstall:** revert the commit (stateless; affects the next install only).
- **Frontend:** revert and rebuild.

## 8. Deferred register (short)

| Item | Why deferred |
|---|---|
| WD-07 ledger append unchecked | Needs a read-only or full `/etc`; rare. Next candidate, a 3-line follow-up in `wd_ledger.sh`. |
| WD-10/F-06 SIM-switch flag ignored by `check_locked`; manual slot reconcile | Real but needs a user SIM switch during an outage. `wd_swap_slot`'s already-on-target return covers the revert case. Next candidate. |
| F-03 in-flight breadcrumb | The TERM cleanup restores `CFUN=1` and saves no longer restart; the remaining window is a kill during Tier 3 |
| F-07 settle floor gaps; F-08 single 90 s verdict | Design work; partly eased by item 6 |
| F-10 `recovery_reason` overwrite | Only affects auto-failback after a quality failover |
| F-14 tower-failover restart paths and tower lock vs Tier 3 | Partly unproven |
| F-15/WD-19 UCI clamping in the daemon | Needs a hand edit or a bad backup; the CGI validates |
| F-17 negative cache, two-way Tier 3, backup-slot edit during failover | Design |
| WD-14 frozen countdown; WD-15 stale tier after SSR | Cosmetic |
| WD-17/F5/F19 auto-disable reason lost on reboot; respawn budget | The page still shows Off, and Alerts lists the reboots |
| WD-18 Tier 1 overrides a manual operator | Unproven |
| WD-21 PID guard trusts `kill -0` | Less relevant once TERM exits cleanly |
| WD-22 events ring unlocked | Rare; poller hot path |
| WD-04 blind when the ping daemon is dead | Health Check covers it |
| F11 non-boolean accepted, F12 revert toast and no-op success, F15 Prometheus liveness, F16 GET writes, F18 timeline | Low |
| F17 three `status.json` pollers; WD-23 float loss | Won't fix (redundant only; replaced by item 6) |
| Shared verify lib with `settings.sh`; dedupe the `alerts.sh` awk; "Test backup SIM" dry run; `unplanned` rows in the watchdog card | Follow-ups |

## 9. Open questions for the user

1. **Reboot figure wording:** the brief asks for the label "Reboots this hour" and the caption "In the last hour", which repeat each other. Keep both, or use the label "Reboots" with the caption "In the last hour"?
2. **Hold-off after an exhausted ladder:** a fixed 15 minutes (recommended), or another fixed length?
3. **Item 13 (SSR window on slow profiles):** added because the test unit's `quiet` profile makes the SSR hold dead code. Keep it in, or defer?
4. **Radio off:** show it as "Paused" with its own one-line explanation (planned), or reuse the maintenance text unchanged (no new translation key)?

## 10. Explained simply

- The watchdog is one very long script. We first cut it into six smaller files, each with one job (settings, status, spotting problems, the recovery steps, SIM switching, the reboot log), without changing what it does.
- To prove nothing changed, a test rig on the PC plays the same made-up scenarios through the old and the new version and checks the results match exactly.
- Then we fix 13 specific problems, each as a small change in one file, so different people can work at the same time without getting in each other's way.
- The bug you saw comes first: the "reboots" number is recounted every minute, and the restarts the watchdog caused show up in Recent Activity even after the restart.
- The watchdog will also say when it has stopped working, stop promptly when asked, and pick up new settings without restarting.
- It will stop fighting you when you turn the radio off, check that a SIM switch really happened, remember a SIM failover across a reboot, and pause for 15 minutes after trying everything.
- Quality checks will look only at results from after the last outage or fix, so a past outage can't trigger a pointless reboot.
- Each fix is first tested with fake data on the PC, then live on the test modem (including a real watchdog reboot), and the modem's settings are put back after every test.
- Anything not clearly a real, user-visible bug with a small fix is written down for later instead of being built now.
