# Watchdog audit, slice 02: SIM paths of `qmanager_watchcat`

Scope: Tier 3 SIM failover, revert, auto-failback (`primary_recheck_*`), SIM-swap settle, startup state recovery, profile / sim_db / poller interplay, AT path behaviour.
Repo: `D:\Projects\QM PROJECT\QManager`, branch `development-home`. READ-ONLY. Live probes were read-only (`uci show`, `cat`, `ls`, read-only AT: `AT+CPIN?`, `AT+QUIMSLOT?`, `AT+QCCID`, `AT+CFUN?`, `AT+QNWLOCK="save_ctrl"`, plus a pure-shell `trap` experiment).
Deployed daemon matches the repo: md5 `ae4076a8...` for `/usr/bin/qmanager_watchcat`, `sim_db.sh`, `profile_mgr.sh`, `watchdog.sh` and the init script all equal the repo copies.
All `path:line` refs are to the repo file unless stated.

---------------------------------------------------------------------------
## 1. Architecture map

### 1.1 Files, state and flags

| Item | Path | Medium | Writer -> reader |
|---|---|---|---|
| Daemon | `scripts/usr/bin/qmanager_watchcat` (1715 lines) | procd (`respawn 3600 5 5`), started only if `uci watchcat.enabled=1` (`scripts/etc/init.d/qmanager_watchcat:23-26`) | |
| Daemon state | `/tmp/qmanager_watchcat.json` | tmpfs | `write_state` (:267-310) -> poller `read_watchcat_state` (`qmanager_poller:1747`), CGI GET |
| **SIM failover record** | `/tmp/qmanager_sim_failover` | **tmpfs (lost on reboot)** | `finalize_sim_failover` (:1068-1076), recheck-return arm (:1227-1235) via `qm_atomic_write`; deleted on failback (:1164) / revert (:1383) / stale resume (:1488) -> poller `read_sim_state` (`qmanager_poller:1805-1845`), CGI GET (`watchdog.sh:225-228`) |
| User revert flag | `/tmp/qmanager_watchcat_revert_sim` | tmpfs | CGI `revert_sim` (`watchdog.sh:546-551`) -> `check_revert_request` (:1358) |
| Reload flag | `/tmp/qmanager_watchcat_reload` | tmpfs | CGI save / quality_thresholds / backup restore -> main loop (:1508) |
| Maintenance lock | `/tmp/qmanager_watchcat.lock`, `/tmp/qmanager_long_running`, live `/tmp/qmanager_profile_apply.pid` | tmpfs | `check_locked` (:317-334) |
| Recovery flag | `/tmp/qmanager_recovery_active` | tmpfs | touched by tiers, removed by `finish_cooldown`; ping daemon only labels `during_recovery` (`qmanager_ping:294`), it does NOT freeze `streak_fail` |
| Known SIMs | `/etc/qmanager/known_iccids` (`sim_db.sh`) | UBIFS | `sim_db_add` on every landed SIM (:819, 843, 1081, 1174, 1237) |
| SIM-switch quiesce flag (not honoured by watchcat) | `/tmp/qmanager_sim_switch_active` | tmpfs | `cellular/settings.sh` -> poller only |

### 1.2 Config keys (UCI `quecmanager.watchcat.*`) and fixed constants

| Key | Daemon default (code) | Live test unit | Notes |
|---|---|---|---|
| `enabled` | 1 if key absent (:155), init script requires `=1` | **0** | |
| `check_interval` | 10 s | 10 | CGI 5-60 |
| `fail_threshold` | 5 consecutive failed PROBES (raw `ping.json streak_fail`) | 5 | CGI 1-20; daemon accepts any numeric incl. 0 |
| `cooldown` | 60 s (tiers 1/2) | 60 | CGI 10-300 |
| `tier1/2/4_enabled` | 1 | 1/1/**0** | |
| `tier3_enabled` | 0 | 0 | |
| `backup_sim_slot` | "" | unset | CGI 1/2/clear; server does NOT require it when tier3 is on |
| `max_reboots_per_hour` | 3 | 3 | |
| `quality_enabled` / `quality_consecutive` | 0 / 5 | 1 / 5 | thresholds from `quality_thresholds.*` |
| `ssr_aware` / `ssr_grace` | 1 / 45 s | 1 / 45 | |
| `primary_recheck_enabled` | 0 | 0 | opt-in |
| `primary_recheck_interval` | 30 **minutes** | 30 | CGI 5-1440; daemon only falls back to 30 for non-numeric (:210) |
| `SIM_SETTLE_SECS` | 90 (constant, :119) | | not UCI |
| `BOOT_SETTLE` / `MODEM_WAIT_TIMEOUT` / `STATUS_STALE_THRESHOLD` | 30 s / 60 s / 30 s | | |

Live ping profile is `quiet`: interval 10 s, `fail_secs` 30, `recover_secs` 20 (`conn_state.sh:264-266`). History ring is 60 samples (`qmanager_ping:83`), i.e. a 10 minute window at 10 s.

### 1.3 State machine (SIM-relevant arcs)

```
monitor --streak_fail>0--> suspect --streak_fail>=fail_threshold--> [ssr_hold_gate] --> recovery
                                                   (also: quality_breach x quality_consecutive)
recovery -> do_recovery -> execute_tierN -> cooldown
   Tier 1: COPS=2, 2s, COPS=0                      cooldown = CFG_COOLDOWN (60)
   Tier 2: CFUN=0, 3s, CFUN=1, wait_for_modem      cooldown = CFG_COOLDOWN
   Tier 3: see 1.4                                 cooldown = max(CFG_COOLDOWN, 90)
   Tier 4: count_recent_reboots, crash.log, reboot (or auto-disable)
cooldown --(cooldown_remaining -= check_interval each loop)--> finish_cooldown
   arms in order: primary_recheck_active -> revert_settle_active -> quality -> reachability
   success: finalize_sim_failover (Tier 3 only) -> monitor
   failure: _cooldown_handle_failure -> [Tier 3: sim_failover_fallback] -> find_next_tier(+1) -> do_recovery  | exhausted -> monitor
locked (any of lock file / long_running flag / live profile-apply PID): entered from ANY state, clears
   tier/counters/revert_settle/primary_recheck_active (sets recheck_interrupted); exit -> monitor,
   then (a) revert unconfirmed Tier-3 swap, (b) re-arm interrupted recheck settle.
```

Main loop order per iteration (:1499-1711): reload flag -> `check_revert_request` -> LOCKED check -> LOCKED exit logic -> cooldown tick -> `read_ping` -> state machine -> `evaluate_quality` -> auto-failback gate -> `write_state` -> sleep.

### 1.4 Tier 3 forward swap (`execute_tier3`, :662-785)

1. Skip (return 1, which falls through to the NEXT tier) if no `backup_sim_slot`, if `AT+QUIMSLOT?` is unreadable, or if backup == current slot.
2. `original_sim_slot=current`; read original `AT+QCCID` (3 x 1 s); `qmanager_tower_failover stop`.
3. `AT+CFUN=0` (abort + `return 0` if rc != 0) -> 2 s -> `AT+QUIMSLOT=N` (result ignored) -> 2 s -> `AT+CFUN=1` (result ignored).
4. `wait_for_modem` (bare `AT`, <= 60 s; on failure `sim_failover_fallback`).
5. `AT+CPIN?` x3 (1 s apart), only rc=0 + `+CPIN: READY` passes; otherwise fallback.
6. `AT+QCCID` for logging only; `current_sim_slot=N` (assumed, NOT read back).
7. Cooldown 90 s, then ONE verdict (ping `reachable`, or fresh `quality_breached`), with up to 3 stale-data extensions.
8. Success -> `finalize_sim_failover` (record file, `sim_db_add`, `auto_apply_profile "watchdog"`, `last_recheck_time=mono`). Failure -> `sim_failover_fallback` (CFUN=0, QUIMSLOT=orig, CFUN=1, wait, QCCID x3, `sim_db_add`, `auto_apply_profile "watchdog_revert"`, tower failover start) then escalate.

### 1.5 Revert and auto-failback

* User revert: CGI drops flag; `check_revert_request` runs `sim_failover_fallback` when `sim_failover_active=true` and state not recovery/cooldown, then `rm` record, 90 s "revert settle" cooldown (no verdict, just returns to monitor).
* Auto-failback (`initiate_primary_recheck`, :1100): every `primary_recheck_interval` min of mono time while in `monitor` with failover active: swap to primary, 90 s settle, fresh verdict (reachable and, for quality failovers, `!quality_breached`). Healthy: delete record, QCCID, `sim_db_add`, `auto_apply_profile "watchdog_failback"`, tower failover start. Unhealthy: swap back to backup, rewrite record, tower failover stop, extra 90 s revert-style settle.

### 1.6 AT commands used

`AT+QUIMSLOT?`, `AT+QUIMSLOT=N`, `AT+CFUN=0/1`, `AT+CPIN?`, `AT+QCCID`, bare `AT` (wait_for_modem). qcmd contract (`docs/features/at-broker.md`): AT `ERROR` is rc 0 with text on stdout; transport failures are rc 1 with `ERROR: modem_busy|modem_not_ready|scan_in_progress|command_timeout|...` on stderr; while `/tmp/qmanager_long_running` exists, short commands (CFUN/QUIMSLOT/CPIN/AT) fast-reject `scan_in_progress`.

---------------------------------------------------------------------------
## 2. Findings

Severity scale: High = can strand the device on the wrong SIM, record a failover that did not happen, or cause an avoidable outage in a normal workflow. Medium = wrong state or extra outage under plausible conditions. Low = robustness / hardening.

| ID | Sev | Status | Title |
|---|---|---|---|
| F-01 | High | CONFIRMED (code) + prior live repro of root cause | Tier 3 / fallback / revert / recheck swaps are never verified |
| F-02 | High | CONFIRMED (code + live `mount`) | Failover record lives in tmpfs: resume-after-reboot is dead code |
| F-03 | High | CONFIRMED (code + live ash test) | Daemon restart/stop/kill mid-failover loses the swap; TERM trap never exits |
| F-04 | High | CONFIRMED (code + live data) | Quality verdicts after a swap read an un-flushed 60-sample window |
| F-05 | Med-High | CONFIRMED (code) | User revert executes while LOCKED / scan running; fails silently and corrupts state |
| F-06 | Med-High | CONFIRMED (code) | Watchdog ignores user-initiated SIM switches (race) and never learns manual slot changes |
| F-07 | Medium | CONFIRMED (code) | Settle floor not applied after failure-revert, and dropped when a profile worker triggers LOCKED; no post-LOCK grace |
| F-08 | Medium | CONFIRMED (code) | Single-shot verdict at a fixed 90 s: no registration/SSR awareness, one slow attach reverts a good swap |
| F-09 | Medium | CONFIRMED (code) | Ladder restarts immediately after exhaustion; no Tier 3 swap cap/backoff; unbounded SIM ping-pong |
| F-10 | Medium | CONFIRMED (code) | `recovery_reason` overwritten and never restored: quality failovers lose their criterion |
| F-11 | Medium | CONFIRMED (code) | `finalize_sim_failover` can record a failover that never happened (aborted Tier 3) |
| F-12 | Med-Low | CONFIRMED (code) | Tier 3 skip on an unreadable slot falls straight through to Tier 4 reboot |
| F-13 | Low-Med | CONFIRMED (code) | Poller SIM identity / band policy not refreshed after watchdog swaps |
| F-14 | Low-Med | partly SUSPECTED | Tower failover daemon stopped but not always restarted; persisted tower lock not considered by Tier 3 |
| F-15 | Low | CONFIRMED (code) | `primary_recheck_interval=0` accepted by the daemon; restore bypasses CGI validation |
| F-16 | Low | CONFIRMED (code) | Unchecked jq-into-file pipelines can publish empty state/failover files and break the GET CGI |
| F-17 | Low | design | One-way Tier 3, no negative cache for a dead/missing backup SIM, backup slot edit during failover inverts roles |

### F-01 (High): the swap is never verified, in any of the four swap sequences

Evidence:
* `execute_tier3`: `qcmd "AT+QUIMSLOT=$CFG_BACKUP_SIM_SLOT" >/dev/null 2>&1` (:720) and `qcmd 'AT+CFUN=1' >/dev/null 2>&1` (:722) are discarded. `current_sim_slot="$CFG_BACKUP_SIM_SLOT"` is simply assigned (:779). The only post-swap gate is `AT+CPIN? == READY` (:744-769), which is also true on the ORIGINAL SIM if the swap silently no-oped. The new ICCID is read "for logging" and never compared with `original_sim_iccid` (:771-777).
* Same pattern in `sim_failover_fallback` (:793-797), `initiate_primary_recheck` (:1113-1117) and the recheck return leg (:1197-1201).
* Contrast: `cellular/settings.sh` (~:380-450) quiesces the poller with `/tmp/qmanager_sim_switch_active`, captures the pre-switch ICCID, uses `verify_quimslot` read-back (up to 10 tries), retries the whole write once, and only then auto-applies a profile.
* Prior live reproduction (agent memory, 2026-07-17): `AT+QUIMSLOT=2` returned OK but the modem stayed on slot 1 for 2+ min while the poller was in a qcmd lock storm. The watchdog Tier 3 runs the identical unquiesced sequence, and SSRs (about 2 per session on this unit) also reset the channel mid-sequence.

Failure scenarios:
1. QUIMSLOT silently no-ops (lock storm, SSR, `modem_busy`). CPIN is READY on the original SIM, so `current_sim_slot` is set to the backup. If connectivity returns for any reason during the 90 s window (the CFUN toggle itself often heals a stalled attach), `finalize_sim_failover` writes `active:true, current_slot:<backup>` for a swap that never happened, adds the wrong ICCID context, and calls `auto_apply_profile` with the still-active ICCID. Result: UI banner "running on backup SIM" while on primary; later Revert / recheck swaps cycle the radio for nothing. If the link does not recover, the "fallback" is also unverified and the ladder escalates to a reboot.
2. `AT+CFUN=1` lost (`modem_busy`, SSR): radio left at CFUN=0. `wait_for_modem` passes (bare AT works at CFUN=0). CPIN may fail -> fallback; the fallback's CFUN=1 is equally unchecked. Tier 2 would heal it later but is skipped under a tower lock.
3. Single-SIM or empty backup slot: `AT+QUIMSLOT=2` answers `ERROR` (rc 0, ignored), the original SIM stays READY, so Tier 3 "succeeds" the CPIN gate (see scenario 1).

Fix: factor settings.sh's `verify_quimslot` + pre/post ICCID differential into a shared lib (e.g. `sim_switch.sh`), raise/clear `/tmp/qmanager_sim_switch_active` around every Golden Rule sequence, verify `AT+QUIMSLOT?` equals the target and `AT+CFUN?` is 1 after the sequence (retry once, then treat as swap-failed: restore CFUN=1 and abort Tier 3 without entering the 90 s cooldown). Treat `AT+CFUN=0` ERROR text as failure too (check the `rc:result` pair, not only rc).

### F-02 (High): `/tmp/qmanager_sim_failover` is the only record and it is tmpfs

Evidence: `SIM_FAILOVER_FILE="/tmp/qmanager_sim_failover"` (:77); live `mount` shows `tmpfs on /tmp`; the poller and CGI read the same path. The startup resume block (:1452-1491) and its comment ("stale SIM failover state from before reboot") can therefore only ever see a record when the daemon was restarted without a reboot. After any reboot (Tier 4, user, power loss, update) the record is gone. AT+QUIMSLOT persists in the modem, and the live unit has no hardware watchdog, so unplanned power cycles are common here.

Failure scenario: Tier 3 fails over to slot 2, an unplanned reboot occurs. The modem boots on slot 2 (persistent), the daemon starts with `sim_failover_active=false`, `original_sim_slot=null`. Consequences: (a) UI failover banner and Revert button vanish; (b) auto-failback never runs; (c) when slot 2 later fails, Tier 3 evaluates `backup(2) == current(2)` -> "TIER 3 SKIPPED" (:680-683) and nothing can ever swap back to slot 1; (d) `sim_db` still lists both ICCIDs, so no "New SIM" signal either.

Fix: keep a durable copy under `/etc/qmanager/` (written with `qm_durable_write`, only at finalize / failback / revert, so flash wear is negligible) and have startup re-seed `/tmp` from it after verifying the live slot. Fallback inference for old state: when `tier3_enabled` and the live slot equals `backup_sim_slot`, assume `original = other slot`, `original_iccid = ""`, and show failover active.

### F-03 (High): a restart/stop/kill mid-failover loses the swap; the TERM trap never exits

Evidence:
* `watchdog.sh:515` runs `/etc/init.d/qmanager_watchcat restart` on EVERY successful `save_settings` while enabled (any card save, even unrelated keys), `:519` stops it when disabled. `config_backup_sections.sh:537-540` does the same on restore. `install.sh:1037-1040` stops then `killall -9`; `qmanager_update:343` stops it.
* In-memory-only SIM state: `original_sim_slot`, `current_sim_slot`, `current_tier`, `recovery_reason`, `primary_recheck_active`, `recheck_return_slot`. The record is written only at finalize (after the 90 s verdict).
* Trap: `trap '...; write_state' EXIT INT TERM` (:1434) has no `exit`. Live test on the device's ash: `sh -c 'trap "echo handled" TERM; kill -TERM $$; echo after_trap_continues'` prints `handled` then `after_trap_continues`. `qmanager_ping:552` and `qmanager_poller:2916` use `...; exit`. procd therefore has to SIGKILL the watchdog after its stop timeout (SUSPECTED: default 5 s; not observed because the daemon is disabled), and meanwhile the loop (and an in-flight Golden Rule sequence) keeps running with its PID file already deleted.

Failure scenarios:
1. User changes any watchdog setting while a Tier 3 cooldown is pending (normal when someone opens the page during an outage). New daemon: no record, `original_sim_slot=null` -> device stranded on the backup SIM, unconfirmed, no failback, no revert, and Tier 3 skipped as "already on backup".
2. Restart or install SIGKILL lands between `AT+CFUN=0` and `AT+CFUN=1` (the sequence takes >= 4 s plus AT time) -> radio stuck at CFUN=0 (Tier 2 would heal it, Tier 1 does not).
3. Restart during a primary-recheck settle: modem is on the primary, record says backup; new daemon sees live != recorded and clears the record (:1486-1489) -> implicit failback without any health verdict, and the tower failover daemon stays stopped.
4. Startup reads `AT+QUIMSLOT?` once before `BOOT_SETTLE` (:1473) and deletes the record on an empty read (:1487-1488). A transient `modem_busy` / `modem_not_ready` (SSR, atcli hang) therefore destroys a valid record.

Fix: write an in-flight breadcrumb (durable or tmp) before Tier 3 / recheck swaps (`phase`, `original_slot`, `target_slot`, `original_iccid`) so a new daemon can finish or revert; make TERM/INT handlers `exit` after cleanup and finish or abort the current AT sequence cleanly; on startup retry the slot read 3 x 1 s after BOOT_SETTLE and keep (not delete) the record when the read stays empty; make the CGI avoid `restart` when only reloadable keys changed (the reload flag already exists).

### F-04 (High): post-swap quality verdicts are computed on a window that is not flushed

Evidence: `quality_breached` reads `status.json .connectivity.avg_latency_ms` / `packet_loss_pct` (:385-446), which the poller computes from `/tmp/qmanager_ping_history`, a 60-sample ring (`qmanager_ping:83`, `qmanager_poller:1610-1639`) that is only truncated at ping-daemon start (`qmanager_ping:571`). The 90 s verdict (:1282-1314) therefore sees only 9 fresh samples of 60 on `quiet` (18 of 60 on `relaxed`, 45 of 60 on `regular`).
Live: `connectivity.packet_loss_pct=8` while the history still holds 5 nulls from an outage that ended 141 s earlier (`last_outage_ago_s:141`).

Failure scenarios:
* Forward, quality-triggered Tier 3: window avg/loss is dominated by the old SIM's bad samples; e.g. loss 50% -> 0.85 x 50 = 42% (still >= 30) -> verdict "still degraded" -> revert to the degraded primary and escalate to Tier 4, even though the backup is perfect. A quality-triggered Tier 3 can essentially never succeed unless the breach was marginal. (Tier 1/2 quality verdicts have the same flaw at 60 s.)
* Recheck for a quality failover (:1146-1150): window is mostly the backup's good samples -> primary judged healthy -> failback to a still-degraded primary -> quality trigger fires again -> Tier 3 swaps back: a ping-pong with period ~ recheck interval.

Fix: judge only post-action samples, e.g. read the tail `k = settle_secs / interval` lines of `/tmp/qmanager_ping_history` directly in the watchdog (awk avg and loss over those), or have the ping daemon expose a "samples since mono T" aggregate; require a minimum sample count.

### F-05 (Med-High): user revert runs while the daemon is LOCKED or a scan/apply is in flight

Evidence: `check_revert_request` is called at :1521, BEFORE `check_locked` at :1524, and only defers for `state = recovery|cooldown` (:1372); it never tests `state = locked`, `check_locked`, or the long-running flag. The lock holder (cell scan with `/tmp/qmanager_long_running`, profile worker, maintenance lock) "owns the modem" per the daemon's own comment (:1528, :1564-1566).
Failure scenario: user clicks Revert during a cell scan. `qcmd 'AT+CFUN=0'` / `QUIMSLOT` / `CFUN=1` all fast-reject `scan_in_progress` (at-broker contract), `wait_for_modem` times out after 60 s, and the slow-modem branch of `sim_failover_fallback` sets `current_sim_slot=original`, `sim_failover_active=false`, `original_sim_slot=null` (:825-828). Then :1383 removes the record. Net: watchdog and UI say "reverted", modem is still on the backup SIM, nothing will ever retry. If the lock holder is a profile worker instead, the revert's CFUN cycle interleaves with the worker's COPS steps.
Fix: in `check_revert_request`, return 1 (keep the flag pending) when `check_locked` or `state = locked|ssr_hold`; after any swap, verify per F-01 and only clear state on a verified slot.

### F-06 (Med-High): user-initiated SIM switches are invisible to the watchdog

Evidence: `settings.sh` raises `/tmp/qmanager_sim_switch_active` (poller quiesce, 60 s mtime bound), but `check_locked` (:317-334) does not look at it. A user switch causes a 30-90 s outage; with `fail_threshold=5` probes (10 s on `regular`, 50 s on `quiet`) Tier 1 (`AT+COPS=2`, a long command that serialises behind the CGI's sequence) and, 60 s later, Tier 2 (`CFUN=0/1`) can fire in the middle of the user's `CFUN=0 -> QUIMSLOT -> CFUN=1` or the attach that follows. With Tier 3 armed it can even swap the user back.
Second part: the daemon never re-reads the live slot after startup. A manual switch while `sim_failover_active=true` leaves the record stale; Revert then runs a pointless CFUN cycle to the slot it is already on, and a recheck swaps to the slot already active before declaring "failback".
Fix: treat a fresh (mtime < ~120 s) `qmanager_sim_switch_active` as LOCKED plus a post-switch settle; periodically (or on each cooldown/recheck decision) reconcile `current_sim_slot` against `AT+QUIMSLOT?` and drop or flip the record when the user changed slots.

### F-07 (Medium): the 90 s settle is not applied everywhere the field evidence requires

Evidence and gaps:
1. Failure path: `_cooldown_handle_failure` (:1001-1031) calls `sim_failover_fallback` (a real CFUN/QUIMSLOT swap) and then escalates immediately: Tier 4 reboots right after the revert, or with Tier 4 disabled (as on the live unit) the daemon returns to `monitor` with no settle. `ping.streak_fail` is still >= threshold (the ping daemon keeps counting through cooldown), so 2 iterations (20 s) later it starts Tier 1 on a SIM that attached ~20 s ago (violates "~90 s after every swap").
2. `revert_settle_active` is cleared on LOCKED entry (:1531). `sim_failover_fallback` invokes `auto_apply_profile` which spawns a detached profile worker (`profile_mgr.sh:676`); the worker's PID file makes `check_locked` true on the next iteration, so every revert / failback return whose SIM has a Custom SIM Profile (the common case for this feature) loses its settle floor and becomes "locked, then monitor".
3. LOCKED exit (:1550-1559) has no grace: `streak_fail` accumulated during the lock (the profile worker's `COPS=2/0` step, `qmanager_profile_apply:404-415`) counts, so recovery can start the moment the worker exits while the link is still re-attaching.
4. The revert / post-recheck settle arms (:1264-1274) return to monitor without any verdict (see F-08).
Fix: hold a monotonic "no-evaluate-until" deadline (`settle_until=mono+90`) as a first-class variable that survives LOCKED and is consulted in `read_ping` consumers; set it after every swap including failure reverts; on LOCKED exit require `streak_fail` to restart from 0 (record the current streak and compare) or hold a short grace.

### F-08 (Medium): one verdict at exactly 90 s, no registration or SSR awareness

Evidence: `finish_cooldown` judges once at `cooldown_remaining<=0` (:1595-1600). `ping.reachable` also needs `recover_secs` of consecutive successes (20 s on `quiet`), so the real attach budget is `90 - recover_secs` (70 s on `quiet`) while the project's own field evidence is "~90 s to stabilise". Only stale-ping data gets extensions (3 x `check_interval`); a plainly unreachable link does not. `ssr_hold_gate` is never consulted from `_cooldown_handle_failure`, so a recoverable baseband SSR landing in the window (about 2 per session on this unit) is judged as "swap failed" and reverts a good failover.
Fix: after the floor, poll until reachable or a hard deadline (e.g. floor + 60 s), and extend while `ssr_in_progress` or `AT+CEREG?/COPS?` show registration in progress. Only then revert.

### F-09 (Medium): no backoff or cap on SIM swaps; the ladder restarts at once

Evidence: on exhaustion the daemon sets `state=monitor, current_tier=0` (:1024-1029, :967-973) while `streak_fail` remains high, so 20 s later it is back at Tier 1. With Tier 4 disabled/capped (live unit: `tier4_enabled=0`) and Tier 3 armed, a two-sided outage (carrier outage, no coverage) produces an endless cycle: T1 (60 s) -> T2 (60 s) -> T3 swap (~25 s + 90 s) -> fallback (~25 s) -> repeat, about 5-6 min per lap, each lap with two full radio detaches. There is no token bucket for Tier 3 comparable to Tier 4's, and no exponential backoff for repeated failed rechecks (`last_recheck_time` reset to now, constant interval, :1246).
Also: a recheck that was due while a recovery was running fires the first moment `state=monitor` again (:1702-1706), i.e. immediately after a real outage ends.
Fix: `tier3_swaps_per_hour` cap + escalating pause after ladder exhaustion (hold monitor for e.g. 5 min x 2^n up to 1 h), and a minimum dwell on a SIM after any swap before the next voluntary swap.

### F-10 (Medium): `recovery_reason` is overwritten and not persisted

Evidence: `initiate_primary_recheck` deliberately keeps `recovery_reason` so a quality failover uses the quality criterion (:1124-1125), but the "primary still unhealthy" arm sets `recovery_reason="unreachable"` (:1252) and the revert path does the same (:1395). The record's `reason` field is written, but the resume block (:1464-1491) never restores it. After the first failed recheck, a second recheck (or any recheck after a daemon restart) judges the primary on reachability only, so a quality-driven failover fails back to a primary that is reachable but degraded.
Fix: keep a dedicated `failover_reason` variable, restore it from `.reason` on resume, and never reuse the transient `recovery_reason` for the recheck criterion.

### F-11 (Medium): bogus failover record from an aborted Tier 3

Evidence: `original_sim_slot="$current_slot"` is assigned at :691, before the `AT+CFUN=0` transport check. If `qcmd 'AT+CFUN=0'` returns rc != 0 the function logs, restarts the tower failover daemon and `return 0` ("action attempted", :712-716), entering a full 90 s cooldown without any swap. `current_sim_slot` is still `"null"` (initial) or stale. If connectivity then returns, `finalize_sim_failover` guards (:1040-1042) pass because `"null" != "1"` and `original != "null"`, and the daemon writes `{active:true, original_slot:1, current_slot:null}` and sets `sim_failover_active=true`. If it does not return, `_cooldown_handle_failure` runs a pointless fallback CFUN cycle. In both cases `original_sim_slot` stays non-null, so a revert flag would stay "mid-flight pending" forever (:1406-1408).
Fix: `return 1` (skip) or restore `original_sim_slot="null"` on every pre-swap abort, and add `[ "$current_sim_slot" != "null" ]` to the `finalize_sim_failover` guards.

### F-12 (Med-Low): unreadable slot is treated as "skip tier", which means reboot

Evidence: `AT+QUIMSLOT?` read once (:672); empty -> `return 1` (:675-678); `do_recovery` treats 1 as "tier skipped" and moves to Tier 4 (:962-968). A transient `modem_busy` / `modem_not_ready` (atcli glink hang is a known ~2x/session condition, SSR also resets the channel) at that single instant converts "try the backup SIM" into "reboot the modem". The same single-shot pattern appears in the startup resume (F-03).
Fix: retry 3 x 1 s with `rc:result` checking; if still unreadable, defer (stay in recovery for one more cycle) rather than skipping to Tier 4.

### F-13 (Low-Med): UI identity and band policy go stale after a watchdog swap

Evidence: `grep force_tier2|refresh_policy_band` shows only `settings.sh`, `bands/lock.sh`, `apn_mgr.sh` and `qmanager_profile_apply:699` touch the poller flags; `qmanager_watchcat` never does. The poller reads ICCID/IMSI at boot and via `refresh_sim_identity` only when `FORCE_TIER2_FLAG` is present (`qmanager_poller:2846`), and policy bands via `REFRESH_POLICY_FLAG`. After forward failover, revert, failback, or recheck return, the dashboard keeps showing the previous SIM's ICCID/IMSI and supported-band policy until the next profile worker (only if a profile matches) or a reboot.
Fix: `touch /tmp/qmanager_force_tier2 /tmp/qmanager_refresh_policy_band` after a verified swap, as `settings.sh` does.

### F-14 (Low-Med, partly SUSPECTED): tower failover daemon and persisted tower lock

Evidence: Tier 3 stops `qmanager_tower_failover` (:707); it is restarted only in `sim_failover_fallback` (:853) and recheck success (:1179). It stays stopped after: stale-record clear at startup (F-03), disabling the watchdog while on backup, daemon restart during failover, update. Separately, the live unit has `AT+QNWLOCK="save_ctrl"` = `1,1` (lock survives reboot) and the daemon's own Tier 2 is skipped under a tower lock (:632-635), but Tier 3 swaps SIMs without releasing or even noticing an active LTE/NR lock; whether a primary-carrier lock blocks the backup SIM's attach is SUSPECTED (not testable read-only).
Fix: restart the daemon on every path that abandons failover state; consider unlocking (or at least logging and skipping) when a lock is active before a SIM swap.

### F-15 (Low): recheck interval floor is not enforced in the daemon

Evidence: `read_config` accepts any numeric `primary_recheck_interval` (:209-210), including `0`; `_pr_due=$((last + 0))` makes the recheck due on every `monitor` iteration (:1704-1706), i.e. a permanent swap loop. The CGI limits 5-1440 but backup restore sets keys unvalidated (`config_backup_sections.sh:525-527`). Docs claim the daemon enforces the minimum (see section 4). Same class: `fail_threshold=0` makes any single failed probe trigger recovery.
Fix: clamp in `read_config` (`[ "$CFG_PRIMARY_RECHECK_INTERVAL" -lt 5 ] && =30`).

### F-16 (Low): unchecked producer pipelines and missing helper stubs

Evidence: `jq ... | qm_atomic_write "$SIM_FAILOVER_FILE"` (:1068-1076, :1227-1235): a jq failure feeds an empty stdin and `_qm_replace` happily installs a 0-byte file (`safe_tmp.sh:75-88`); `watchdog.sh:225-227` then passes it to `--argjson` and the whole GET fails until the file is removed. `write_state` does `jq ... > "$STATE_TMP"; mv` (:271-309) and has the same hole (a non-numeric `cooldown`/`failures` value breaks `--argjson`). `safe_tmp.sh` is sourced with `[ -f ] &&` and no stubs (:38), so a missing lib silently skips the failover write (`qm_atomic_write` undefined) and treats every revert flag as untrusted.
Fix: build JSON into a variable, test non-empty and valid, then write; add stubs or a hard fail.

### F-17 (Low, design): remaining gaps

* Tier 3 is one-way: once failed over, `backup == current` skips Tier 3 forever; the only way back is the opt-in recheck or a manual revert (`:680-683`).
* No negative cache: a missing/dead backup SIM costs a CFUN cycle plus fallback on every ladder pass.
* Editing `backup_sim_slot` while failover is active makes `execute_tier3` overwrite `original_sim_slot` with the current backup slot (:691), inverting primary/backup in the next record.
* LOCKED-exit revert of an unconfirmed swap (:1567-1576) discards a possibly good failover instead of re-arming the verdict (as the recheck path now does); defensible but worth documenting.
* `uninstall.sh` / `qmanager_update` do nothing about a device left on the backup SIM.

### Checked and OK (no finding)

* Parsing of `AT+QUIMSLOT?`, `AT+CPIN?`, `AT+QCCID` verified live: `slot=[1]`, `grep -q '^+CPIN: READY'` rc 0, ICCID 20 chars; no regex in jq in these paths (device jq has none); no bashisms found; `local` is single-var per line; all numeric compares guarded or CGI-validated.
* `sim_failover_active` JSON bug (older agent memory, 2026-06-20) is fixed: `--arg sf_active` + string compare (:281, :298). `original_iccid` is now captured (:693-704).
* Wall-clock misuse in the SIM flow is cosmetic only (`switched_at`, `last_recovery_time`). Cooldown uses loop counts, the auto-failback clock uses `mono_now`, staleness uses `/proc/uptime`. (Out of slice: `count_recent_reboots` compares wall-clock `date +%s` with crash.log epochs written from the same wall clock, so a boot-time clock step can skew the Tier 4 token bucket.)
* Stale-ping retry in cooldown (:1319-1331) and `cooldown_stale_retries` resets look correct.
* Lock/PID hygiene: single-instance PID check (:1421-1431) and trusted-file checks for the failover record and revert flag (B4.1) are present.
* LOCKED-exit unconfirmed-swap revert (9e9be036) and interrupted-recheck re-arm (19dc91dc) are present and logically consistent with the documented conditions; they do not loop (fallback resets `original_sim_slot` to null).

---------------------------------------------------------------------------
## 3. Status of the 2026-05-12 audit (`docs/2026-05-12-watchdog-sim-failover-audit-fixes.md`)

| # | Original finding | Status now | Where / notes |
|---|---|---|---|
| 1 (HIGH) | `wait_for_modem` ignored in fallback | **Present and correct** | `qmanager_watchcat:803-830`; improved: slow-modem path records ICCID via `sim_db_add` |
| 2 (HIGH) | Persist ICCID after T3 swap/fallback (`last_iccid`) | **Present, evolved** | Replaced by the known-SIMs DB: `sim_db_add` at :819, :843, :1081, :1174, :1237. `/etc/qmanager/last_iccid` is legacy, now only migrated by `sim_db_seed_if_absent` (`sim_db.sh:62-77`). Plan text is obsolete |
| 3 (MED) | Stale ping data treated as failure | **Present and correct** | `cooldown_stale_retries`, 3 extensions (:1319-1331; quality arm :1282-1294); reset on LOCKED entry/exit and revert arm. `_cooldown_handle_failure` no longer primes `CFG_MAX_FAILURES` (variable retired) and calls `do_recovery` directly |
| 4 (MED) | Block save when Tier 3 on without backup slot | **Present in UI only** | `components/monitoring/watchdog/use-watchdog-form.ts:247-248` (the old `watchdog-settings-card.tsx` no longer exists); `watchdog.sh` does not enforce it server-side; daemon skips tier silently |
| 5 (MED) | Emit "SIM failover confirmed" event | **Present** | :1085 |
| 6 (MED) | Poll settings every 30 s for `auto_disabled` | **Present** | `hooks/use-watchdog-settings.ts:167-172` |
| 7 (LOW) | Verify live slot on resume | **Present but neutralised** | Code at :1464-1489 is correct for restarts, but the record is in tmpfs (F-02) and a single unreadable read deletes it (F-03 #4) |
| 8 (LOW) | JSON-safe record write | **Present** | `jq -n -c --arg ... | qm_atomic_write`; see F-16 for the unchecked-pipeline hole |
| 9 (LOW) | "Test backup SIM" dry run | **Not implemented (deferred by design)** | No code; would also need F-01's verified-swap primitive |

Plan-document drift: Tasks reference `CFG_MAX_FAILURES`, `/etc/qmanager/last_iccid` writes, `watchdog-settings-card.tsx`, and a `suspect`-bounce escalation; all superseded. Suggest marking the file as historical.

---------------------------------------------------------------------------
## 4. Doc-vs-code drift (`docs/features/connection-watchdog.md` unless stated)

1. Line ~684 "The minimum 5-minute interval is enforced by both the UCI validation range (5-1440) and the daemon's fallback default": the daemon only falls back to 30 for non-numeric values; `0` and `1-4` pass (:209-210) (F-15).
2. Line ~558 "No full daemon restart is needed" and line 436 "restart or stop the daemon as appropriate": code always restarts on every enabled save (`watchdog.sh:515`) in addition to touching the reload flag; the restart drops in-flight SIM state (F-03).
3. Lines 24 and 579-610 describe `/tmp/qmanager_sim_failover` without stating it is volatile; the code comment at `qmanager_watchcat:1452` ("from before reboot") implies persistence that does not exist (F-02).
4. Line 26 / 646-650: settle floor "applies to both forward Tier-3 swap and user-requested revert". Actually also applied to recheck and post-recheck return, but NOT to the failure-revert in `_cooldown_handle_failure`, and the revert settle is dropped when a profile worker triggers LOCKED (F-07). Line 650 documents the LOCKED clear as a safety feature without stating this consequence.
5. Line 666-668 / 678-680: recheck "uses the quality criterion iff the failover was quality-driven": true only until the first failed recheck or restart (`recovery_reason` overwritten, F-10).
6. Lines 299-305 and 328-331: quality success criterion described as "fresh `read_quality`", with the window described as ~60 samples; the doc never notes that post-action verdicts read a window that still contains pre-action samples (F-04).
7. Lines 598-600 list the Tier 3 steps as if the swap is checked; the doc does not mention that only `CPIN` gates success and `QUIMSLOT`/`CFUN=1` results are discarded (F-01).
8. Line 3 "disabled by default on fresh installs" holds via the init guard; the daemon's own default for a missing key is `enabled=1` (:155), which is only safe because of the guard.
9. Lines 156-158 "frontend requires a backup slot": true for the UI; `watchdog.sh` accepts `tier3_enabled=true` with an empty slot.
10. `docs/features/connection-watchdog.md` scenario 7 (auto-failback full loop) is still marked PENDING live; it remains untested on hardware.

---------------------------------------------------------------------------
## 5. Suggested fix order

1. F-01 (shared verified-swap primitive with poller quiesce) because F-05, F-11, F-13 and the "test backup SIM" feature all build on it.
2. F-02 + F-03 together (durable record + in-flight breadcrumb + TERM handler + no-restart-on-reload).
3. F-04 (post-action sample window), then F-07/F-08/F-09 as one "settle + verdict + backoff" change.
4. F-05, F-06, F-10, F-11, F-12, F-13 small independent fixes.
5. Hardening: F-14, F-15, F-16, F-17.

Validation notes for whoever implements: on-device tests need two SIMs and a stubbed harness (as 19dc91dc used) for the recheck arms; the quiesce/verify behaviour can be exercised without a second SIM by pointing the harness `qcmd` at a fake that swallows `QUIMSLOT=`. Static-only passes have shipped broken scripts here before.
