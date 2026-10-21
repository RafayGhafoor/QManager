# Watchdog audit 01: daemon core (`qmanager_watchcat`)

Scope: `scripts/usr/bin/qmanager_watchcat` (1715 lines; deployed copy on the test unit is byte-identical, md5 `ae4076a8...`), `conn_state.sh`, `qlog.sh` (`record_planned_reboot`, `mono_now`), `events.sh` (`append_event`), init.d script, and `docs/features/connection-watchdog.md`.
Method: full read of the daemon, then read-only probes of the live RM551E (watchcat is DISABLED there: `enabled=0`, `tier4_enabled=0`, `quality_enabled=1`, ping profile `quiet`/10 s, quality thresholds custom 800 ms / 20 %). Nothing was written, restarted or enabled. Live probes were `cat`, `uci show`, `ps`, `ubus call service list`, `dmesg`, `mount`, and inline `sh -c` / `awk` / `jq` experiments that create no files.

Conventions: CONFIRMED = traced in code and/or reproduced live; SUSPECTED = plausible from code but not reproducible without live-state writes.

---------------------------------------------------------------------------

## 1. Architecture map

### 1.1 Files

| File | Direction | Notes |
|---|---|---|
| `/tmp/qmanager_ping.json` | read | via `conn_state_read` (`read_ping`, daemon:357). Stale rule `age > max(3*interval_sec, 15)` on monotonic `mono` vs `/proc/uptime`; wall-clock only when `mono` absent/0. Fail-closed: stale returns 1, previous `ping_*` values kept, cycle skipped |
| `/tmp/qmanager_status.json` | read (quality only) | `read_quality` (daemon:385): `.connectivity.avg_latency_ms`, `.packet_loss_pct`, root `.timestamp`/`.mono`; stale > 30 s = no-signal |
| `/tmp/qmanager_watchcat.json` | write | `write_state` (daemon:267), tmp+`mv` (atomic). Read by poller (`read_watchcat_state`, ignores `.timestamp`) and CGI (`cat`) |
| `/tmp/qmanager_watchcat.pid` | write | duplicate-instance guard only; nothing else consumes it |
| `/tmp/qmanager_recovery_active` | write | touched in every recovery path; read by `qmanager_ping` -> `during_recovery` -> poller event suppression. Removed in `finish_cooldown`, exhausted paths, EXIT trap, init `stop_service` |
| `/tmp/qmanager_watchcat_reload` | read+rm | reload request (`read_config`) |
| `/tmp/qmanager_watchcat_revert_sim` | read+rm | user SIM revert |
| `/tmp/qmanager_watchcat_disabled` | write (auto-disable) | read by CGI GET -> `auto_disabled` |
| `/tmp/qmanager_watchcat.lock` | read | maintenance lock (installer/config-restore) |
| `/tmp/qmanager_long_running` | read | scans |
| `/tmp/qmanager_profile_apply.pid` | read | profile apply (pid liveness via `kill -0`) |
| `/etc/qmanager/tower_lock.json` | read | Tier 2 skip |
| `/etc/qmanager/crash.log` | write (Tier 4) + read | `<epoch>|reboot|tier4_escalation`, trimmed to 20 lines. Shared with `record_planned_reboot` and `alert_engine` |
| `/tmp/qmanager_sim_failover` | write/read | SIM failover record (tmpfs, so it does NOT survive a reboot; see WD-24) |
| `/tmp/qmanager_events.json` | write | `append_event`, ring of `MAX_EVENTS=50` shared with the poller |
| UCI `quecmanager.watchcat.*`, `quecmanager.quality_thresholds.*` | read; `enabled` written on auto-disable | |

### 1.2 Config keys and defaults (daemon-side defaults, `read_config` daemon:153)

| Key | Daemon default | Doc default | Validation in daemon | CGI range |
|---|---|---|---|---|
| `enabled` | **1 if key absent** (daemon:155) | 0 | none | bool |
| `check_interval` | 10 | 10 | none | 5-60 |
| `fail_threshold` | 5 (garbage -> 5) | 5 | digits only | 1-20 |
| `cooldown` | 60 | 60 | none | 10-300 |
| `tier1..4_enabled` | 1/1/0/1 | same | none | bool |
| `backup_sim_slot` | "" | empty | none | 1/2/null |
| `max_reboots_per_hour` | 3 | 3 | none | 1-10 |
| `quality_enabled` | 0 | 0 | none | bool |
| `quality_consecutive` | 5 | 5 | none | 1-60 |
| `ssr_aware` / `ssr_grace` | 1 / 45 | 1 / 45 | none | bool / 10-120 |
| `primary_recheck_enabled` / `_interval` | 0 / 30 (min) | 0 / 30 | digits only (interval) | bool / 5-1440 |
| shared `quality_thresholds.*` | 250 ms / 30 % (absent section) | same | digits only for custom | |
| constants | `BOOT_SETTLE=30`, `MODEM_WAIT_TIMEOUT=60`, `SIM_SETTLE_SECS=90`, `STATUS_STALE_THRESHOLD=30` | | | |

### 1.3 States (the `state` variable; `state` JSON field)

`monitor`, `suspect`, `ssr_hold`, `recovery` (transient, never visible in the file: it is set and replaced within one loop pass, and the main-loop `recovery)` arm is dead code), `cooldown`, `locked`, `disabled` (exit only). Not represented in the file but live in memory: `revert_settle_active`, `primary_recheck_active`, `recheck_interrupted`.

### 1.4 Loop order (daemon:1499-1712), one pass per `CFG_CHECK_INTERVAL` (plus action time)

1. If `RELOAD_FLAG`: rm, `read_config`; if `enabled!=1` -> `state=disabled`, `write_state`, exit 0.
2. `check_revert_request` (SIM revert; runs BEFORE the lock check, see WD-13).
3. `check_locked` (lock file | long-running flag | live profile-apply PID). Entering `locked`: clears recovery flag, tier, counters, ssr hold, abandons recheck settle. Leaving `locked`: reverts an unconfirmed Tier-3 swap, re-arms an interrupted recheck. `write_state; sleep; continue`.
4. If `cooldown`: `cooldown_remaining -= CHECK_INTERVAL`; at <=0 run `finish_cooldown`. `write_state; sleep; continue`. (Cooldown is counted in loop passes, not wall time: no clock dependency.)
5. `read_ping`; stale/missing -> `write_state; sleep; continue` (state unchanged: fail-closed, but invisible to UI, see WD-08).
6. `failure_counter = ping_streak_fail` (display mirror only).
7. State machine on the RAW `streak_fail`:
   - `monitor`: `streak_fail > 0` -> `suspect` (one pass of latency; the threshold is not checked in the same pass).
   - `suspect|ssr_hold`: `reachable==true && streak_fail==0` -> `monitor` (+`ssr_hold_clear`). Else if `streak_fail >= fail_threshold` -> `recovery`, `recovery_reason=unreachable`, `find_next_tier 1` if tier 0, `ssr_hold_gate` (hold -> `ssr_hold`, `continue`), else `do_recovery`.
8. If `monitor|suspect`: `evaluate_quality` (below).
9. Auto-failback recheck (opt-in).
10. `write_state; sleep $CHECK_INTERVAL`.

### 1.5 Detection

- Reachability: raw `streak_fail >= fail_threshold` (probe count, not time). Time to fire = `fail_threshold * ping_interval` + up to 2 loop passes (one for monitor->suspect, one for the threshold check). On the test unit (`quiet`, 10 s, threshold 5) that is 50 s + 10-20 s.
- Quality (opt-in): `read_quality` (fresh `status.json`), `quality_breached` (latency via awk float compare, loss via `[ -ge ]`; threshold 0 = ignore), breach counter++ per pass, fires at `quality_consecutive`; no-signal leaves counter untouched; non-breach resets it.
- Both feed one ladder; `recovery_reason` only changes the cooldown success test and the failover `reason`.

### 1.6 Ladder and actions

| Tier | Action | Skip when | Post |
|---|---|---|---|
| 1 | `AT+COPS=2`, 2 s, `AT+COPS=0` | disabled | cooldown |
| 2 | `AT+CFUN=0`, 3 s, `AT+CFUN=1`, `wait_for_modem` (<=60 s) | tower lock enabled (lte or nr_sa), long-running flag | cooldown |
| 3 | stop tower failover; `CFUN=0`, `QUIMSLOT=N`, `CFUN=1`, `wait_for_modem`, `AT+CPIN?` x3; failure -> `sim_failover_fallback` | no backup slot; unreadable slot; backup==current | cooldown = `max(cooldown, 90)`; finalize on success |
| 4 | token bucket check, append `crash.log`, trim to 20, `write_state`, `( sleep 1; sync; reboot ) &`, `exit 0` | bucket exhausted -> `uci enabled=0`, DISABLED_FLAG, `state=disabled`, `exit 0` | none (reboot) |

`do_recovery` recursion: tier returns 1 (skipped) -> `find_next_tier current+1` -> recurse, else "exhausted" -> `monitor`, counters reset. After an action: `last_recovery_*`, `total_recoveries++` (per tier action, not per episode), `cooldown`.

### 1.7 Cooldown completion (`finish_cooldown`, daemon:1133)

Order of arms: primary-recheck settle -> post-revert settle -> quality success test (fresh `read_quality` + `!quality_breached`, 3 stale retries) -> reachability success test (fresh `read_ping`, `reachable==true`, 3 stale retries). Success: `finalize_sim_failover` (guarded no-op unless Tier 3), reset to `monitor`. Failure: `_cooldown_handle_failure`: revert unconfirmed Tier-3 swap, `find_next_tier current+1` -> directly `do_recovery` (no suspect bounce), else exhausted -> `monitor`.

### 1.8 Tier-4 token bucket

`count_recent_reboots` = rows with `$1 >= now-3600` and `$3 == "tier4_escalation"`. Reboot allowed while `count < max` (so `max=3` allows 3 reboots; the 4th attempt auto-disables). Auto-disable: `uci set enabled=0; uci commit`, `touch DISABLED_FLAG`, `exit 0`. Re-enabling is only via the CGI (which `rm`s the flag and restarts); the ledger rows themselves expire only with the wall-clock hour, so re-enabling inside the hour makes the next Tier-4 attempt disable it again without rebooting (by design, not documented).

### 1.9 SSR hold

`ssr_hold_gate` is only consulted when a recovery is about to START (reachability breach or quality breach). `ssr_in_progress`: last `4080000.remoteproc-mss: fatal error received` dmesg line, integer seconds vs `/proc/uptime`, true when `0 <= delta <= CFG_SSR_GRACE`. Hold lasts `CFG_SSR_GRACE` from hold start. Parse verified live (see 3).

### 1.10 Process lifecycle

procd (`USE_PROCD=1`), `respawn 3600 5 5`, `term_timeout 5` (both confirmed live on the sibling `qmanager_atd` instance via `ubus call service list`; same params in the watchcat init script). `start_service` only registers an instance when UCI `enabled=1`. CGI save-with-enable does `enable` + `restart` (fire-and-forget) AND touches the reload flag. `stop_service` removes PID file and recovery flag. `trap ... EXIT INT TERM` (daemon:1434) does `rm` + `write_state`.

---------------------------------------------------------------------------

## 2. Findings

Severity scale: critical = can brick connectivity / reboot-loop unattended; high = wrong recovery action or blind watchdog on a realistic path; medium = incorrect state/edge failure with a workaround; low = hygiene.

| ID | Sev | Status | Location | Title |
|---|---|---|---|---|
| WD-01 | medium | CONFIRMED (known) | daemon:495, 1449, 863 | `reboots_this_hour` stale between start and Tier 4 |
| WD-02 | high | CONFIRMED | daemon:385-446, 1281-1315 | Quality trigger and success test use a 60-sample lagging window: false retrigger after any outage, and escalation to Tier 4 on a healthy link |
| WD-03 | high | CONFIRMED (code); live repro needs writes | daemon:317-334, 630-660 | Watchdog fights user airplane mode (CFUN 0/4): Tier 2 turns the radio back on |
| WD-04 | high | CONFIRMED (code) | daemon:267-310, 1607-1612; poller:1757-1782; derive.ts:116-132 | UI cannot tell a dead/hung daemon from a healthy one ("silently never acts") |
| WD-05 | medium | CONFIRMED (arithmetic on live config) | daemon:527-552, 558-588 | SSR hold never engages on slow ping profiles |
| WD-06 | medium | CONFIRMED (live synthetic) | daemon:495-507 | Token bucket is wall-clock; RTC is 1970 at every boot: over- and under-count |
| WD-07 | medium | CONFIRMED (code) | daemon:886-899 | Token bucket fails open if the ledger append fails; ubifs is mounted `assert=read-only` |
| WD-08 | medium | CONFIRMED (live ash test) | daemon:1434 | SIGTERM does not stop the daemon; trap resumes the loop; real stop is SIGKILL after 5 s, possibly mid-recovery |
| WD-09 | medium | CONFIRMED (code) | CGI save + daemon main | Every settings save restarts the daemon, discarding in-memory recovery state (incl. an unconfirmed Tier-3 swap) |
| WD-10 | medium | CONFIRMED (code) | daemon:317-334 vs poller:2648 | `check_locked` ignores the SIM-switch flag (and has no staleness bound on any lock source) |
| WD-11 | medium | CONFIRMED (code) | daemon:1521 vs 1524 | `check_revert_request` runs before the lock check: revert swap can run during maintenance |
| WD-12 | medium | CONFIRMED (code) | daemon:1039-1042, 1005 | Aborted Tier 3 (`CFUN=0` failed) leaves `current_sim_slot="null"`; finalize/fallback guards read that as "slot moved" |
| WD-13 | low | CONFIRMED (code) | daemon:267-310 | `write_state` clobbers the state file with 0 bytes if any `--argjson` input is invalid |
| WD-14 | low | CONFIRMED (code) | daemon:1542, 1596 | `cooldown_remaining` not cleared on LOCKED entry: frozen countdown shown in `locked` and then `monitor` |
| WD-15 | low | CONFIRMED (code) | daemon:1655, 1636-1642 | Stale `current_tier` after SSR-hold natural recovery bypasses `find_next_tier 1` |
| WD-16 | low | CONFIRMED (code) | daemon:923-935 | All tiers disabled -> pseudo-recovery on tier 0 every cycle (events spam, recovery flag churn) |
| WD-17 | low | CONFIRMED (code + procd semantics) | daemon:869-880, 1439 | Auto-disable comment "procd won't respawn" is wrong; respawn overwrites state file; disable reason is lost on reboot |
| WD-18 | low-medium | SUSPECTED | daemon:619-660 | Tier 1 `COPS=0` overrides a manual operator selection; Tier 2 never verifies `CFUN=1` took |
| WD-19 | low | CONFIRMED (code) | daemon:153-217 | `read_config` leaves old values when a key is deleted; non-numeric hand-edited values defeat guards |
| WD-20 | low | CONFIRMED (design) | daemon:934-994, 1018-1030 | No backoff between repeated exhausted ladders when Tier 4 is off |
| WD-21 | low | CONFIRMED (code) | daemon:1421-1431, 72-81 | PID-file duplicate guard trusts `kill -0` only; stale `RECOVERY_FLAG` not cleared at start; fixed `.tmp` names in `/tmp` |
| WD-22 | low | CONFIRMED (code) | events.sh:33-52 | Event append/trim is unlocked and shared with the poller; ring of 50 evicts watchdog rows in about an hour of CA flapping |
| WD-23 | low | CONFIRMED (code) | daemon:385-424 | `q_packet_loss` float would silently become 0 (defensive) |
| WD-24 | medium (cross-ref to SIM auditor) | CONFIRMED (code + mount) | daemon:1452-1491 | SIM failover state lives in tmpfs: resume logic cannot survive a reboot, comment/doc imply it does |

### WD-01 (known bug) `reboots_this_hour` is stale

- Evidence: `count_recent_reboots` is called at daemon:1449 (start) and daemon:863 (inside `execute_tier4`, which then exits). The main loop never refreshes `reboots_this_hour`, yet every `write_state` re-emits the old value. Consumers: poller `read_watchcat_state` (poller:1769) -> `status.json .watchcat.reboots_this_hour` -> `derive.ts:253` (the UI source already carries the comment "running total since start, never a rolling hour", derive.ts:297). Live: no `tier4_escalation` row exists on the test unit (`live_count=0`) so the symptom cannot be reproduced here, but the call graph is unambiguous. The user's "1 for days": reboot at T, daemon restarts, counts 1 at start, never recounts.
- Failure scenario: after the hour elapses the UI still shows `1 / 3` (alert tone). Worse in the other direction: a Tier-4 row written by a previous daemon instance is counted at start, so after a settings-save restart the number jumps.
- Proposed fix (daemon): add a cheap periodic recount in the main loop, before `check_locked`, so it also runs while locked/cooldown. Declare `_rb_next=0` with the other globals, then:

```sh
        # Keep reboots_this_hour a rolling hour (awk over a <=20 line file; ~1/min)
        _rb_now=$(mono_now)
        if [ "$_rb_now" -ge "$_rb_next" ] 2>/dev/null; then
            count_recent_reboots
            _rb_next=$((_rb_now + 60))
        fi
```

  (`mono_now` returns 0 on parse failure; then the recount just runs every pass, which is harmless.) The poller re-reads the file when its mtime advances, which already happens every pass.
- Proposed fix (CGI, for when the daemon is stopped): in `watchdog.sh` GET, after `status_json=$(cat ...)`, overlay `.reboots_this_hour` with the same awk against `crash.log` so the settings page is right even with the daemon off. The band reads the poller copy, so the daemon fix is the one that matters for the status card.
- Make `count_recent_reboots` clock-aware at the same time (see WD-06).

#### Persistent recent-reboot record for the Recent Activity feed (assessment)

Yes, it should feed the UI. Evidence it is needed:
- Events live in `/tmp/qmanager_events.json` (tmpfs) and are capped at `MAX_EVENTS=50`, shared by ALL poller event types. Live: 20 events after 25 min of uptime, 12 of them `ca_change` (this unit flaps CA about every 2 minutes). A watchdog row would be evicted in roughly 1.5 h on this unit even without a reboot, and is lost outright at the Tier-4 reboot that the row describes. So the Tier-4 reboot is the one watchdog action that can never appear in the feed after the fact.
- `crash.log` already persists exactly that fact (`<epoch>|reboot|tier4_escalation`), and `monitoring/alerts.sh:158-173` already turns it into `reboots[]` (`watchdog|user|unplanned`, newest first, cap 10) for the Alerts page. Reusing it is a pure read.
- Recommended design: (a) `watchdog.sh` GET returns `recent_reboots` built from `crash.log` (hoist the alerts.sh awk into a shared helper, e.g. `crash_log_recent_json <limit> [reason-filter]` in `qlog.sh`; do not duplicate it); (b) `recovery-activity-card.tsx` merges `tier4_escalation` rows as "Watchcat rebooted the modem (Tier 4)" and optionally `unplanned` rows as "Unexpected restart (not caused by the watchdog)" (that is the only evidence of the AP-hang class the watchdog cannot see); omit `user` rows. (c) Limits to state in the doc: the file is a shared 20-row ledger, so a long run of `unplanned` rows can push out older tier4 rows (does not affect the 1-hour bucket); epoch is wall-clock (WD-06), so rows written while the RTC reads 1970 would sort/label wrongly (UI already has `CLOCK_PLAUSIBLE_AFTER`).
- Optional (b+): a tiny dedicated persistent ledger (e.g. `/etc/qmanager/watchdog_events.ndjson`, cap about 30 lines, same `record_planned_reboot` flock pattern) written only for rare, significant lifecycle events (tier started, escalated, exhausted, auto-disabled with the bucket numbers, SIM failover/failback). That also solves the lost auto-disable explanation (WD-17). Flash cost is negligible (a handful of lines per incident). Needs a `sync`, lifecycle-lockstep entries in install/update/uninstall (uninstall must keep or purge it with config).

### WD-02 Quality trigger and success test read a 10-minute smoothed window

- Evidence: `read_quality` consumes `.connectivity.avg_latency_ms` / `.packet_loss_pct` (daemon:388-392). The poller derives both from the last 60 ping-history samples (`PING_HISTORY_RAW`, awk in poller:1611-1640, `CONN_HISTORY_SIZE=60`, `history_interval_sec` 10 on the test unit, so about 10 minutes). Live snapshot: `latency_history` holds 60 values with 5 `null`s and `packet_loss_pct=8` (5/60), thresholds in effect 800 ms / 20 %.
- Failure scenario (reachability outage then quality retrigger): any outage long enough to lose 20 % of the window (12 samples = 2 min on this unit; 18 samples = 3 min at the `tolerant` 30 % default) leaves `packet_loss_pct` above threshold for about 10 minutes AFTER the link is healthy. `quality_enabled=1` then accrues 5 breaches in 50 s and starts a quality recovery on a working link. Its cooldown success test (`finish_cooldown` quality arm, daemon:1281-1314) rereads the same window after 60 s: only 6 of 60 samples are new, so loss is still at or above threshold, the test fails, and `_cooldown_handle_failure` escalates Tier 1 -> 2 -> 3 -> 4 within about 4-5 minutes, ending in a reboot (bounded only by the bucket). The window therefore both false-triggers and false-fails.
- Fix proposals (pick one, A preferred):
  - A. Evaluate on the freshest samples, not the 60-sample aggregate: take the tail of `.connectivity.latency_history` (array of values with `null` = lost) with `N = quality_consecutive` (or `max(quality_consecutive, 6)`) samples, compute loss and mean latency from those with a single `jq` (no regex needed). For the post-action test use only samples newer than the action: count `elapsed / history_interval_sec` and clamp 1..60 (history is append-only, newest last).
  - B. Add post-recovery blanking: after any recovery episode (success or exhausted), ignore quality for `history_size * history_interval_sec` seconds or until `packet_loss_pct` first dips below threshold, and base the post-action success test on "no new breach observed for K consecutive passes after cooldown" instead of an absolute level.
  - Either way keep `quality_breach_counter` reset on any recovery episode (the reachability success arm, daemon:1342-1346, does not reset it).
- Doc gap: the doc's "Detection is not instantaneous" only discusses slow detection; it does not mention that the same lag drives the success test and re-triggering.

### WD-03 Airplane mode (CFUN 0/4) is not respected

- Evidence: `check_locked` (daemon:317-334) knows only the lock file, long-running flag and profile apply. `cellular/settings.sh:290-294` lets the user set `AT+CFUN=0|1|4`; `events.sh:675-681` even logs "Airplane mode enabled (CFUN=n)" (this unit has two such events right now). `status.json` carries `network.cfun`. Nothing in the watchdog reads it.
- Failure scenario: user enables airplane mode -> `streak_fail` climbs -> reachability breach -> Tier 1 (`COPS` under CFUN 0 returns an error, ignored) -> cooldown -> Tier 2 `AT+CFUN=0` then `AT+CFUN=1` (daemon:649-657) switches the radio back ON against the user's choice; Tier 4 (default on) can then reboot. Not reproduced live (needs an airplane toggle, i.e. a live-state write).
- Fix: before any detection decision (top of the loop, next to `check_locked`) or at minimum before `do_recovery`, read `network.cfun` from fresh `status.json` (or `qcmd 'AT+CFUN?'` once at breach time) and treat `cfun != 1` as a maintenance-like hold: new state (or reuse `locked`) with a log line and no counters accruing. Add a doc line. Tier 2/3 must never run `CFUN=1` on a modem the user put in airplane mode.

### WD-04 The UI cannot tell that the daemon is dead or blind

- Evidence: poller `read_watchcat_state` (poller:1757-1782) reads the state file's fields but NOT `.timestamp`, and nothing checks `/tmp/qmanager_watchcat.pid` or `kill -0`. `derivePhase` (derive.ts:116-132) shows `watchcat.state` whenever `watchcat.enabled` is true. The CGI just `cat`s the file (watchdog.sh:220-222).
- Failure scenarios (all of which render "Monitoring" forever): (1) daemon killed (OOM/SIGKILL) and procd's respawn budget (`retry 5` within 3600 s) exhausted; (2) daemon hung inside a `qcmd` call (no timeouts anywhere in the daemon, e.g. `wait_for_modem`, Tier 3 `AT+QCCID` loops); (3) the ping daemon dead: `read_ping` returns 1 every pass, loop does `write_state; sleep; continue` with `state` unchanged, logging a warning per pass (daemon:1607-1612) but never telling the UI the watchdog is blind; (4) stale file left from a crash while `enabled=true`.
- Fix: add `pid` and `mono` (`mono_now`) to `write_state`; have the poller (or CGI) mark the watchcat as `not_running` when `mono` is older than `3 * CHECK_INTERVAL + 120` (Tier 3 can legitimately hold the loop for minutes, so write a state heartbeat BEFORE long actions, see below) or when `kill -0 pid` fails. Add a `blind: true` / `input_stale_since_mono` field set when `read_ping` has failed N consecutive passes, and surface it as a warning phase. Write the state once with `state=recovery` before calling `do_recovery` so the UI actually sees the recovery phase and a fresh timestamp during long actions (today the file shows the previous state for up to 3-4 minutes during Tier 3, and `recovery` is never visible).

### WD-05 SSR hold is inert for slow ping profiles

- Evidence: the hold can only start when the reachability breach fires (`ssr_hold_gate` is called at daemon:1664 after `streak_fail >= fail_threshold`) and only if the crash line is at most `CFG_SSR_GRACE` (45 s) old at that instant (daemon:550). Time from SSR to breach = `fail_threshold * ping_interval` + 1-2 loop passes. Live config: ping `quiet` = 10 s interval (`/tmp/qmanager_ping.json`), `fail_threshold=5`, `check_interval=10` -> 50 s + 10-20 s = 60-70 s after the crash > 45 s, so `ssr_in_progress` is false and the ladder fires into the self-heal, exactly what the feature exists to prevent. `relaxed` (5 s) is borderline (25-45 s); `regular`/`sensitive` fine. Live `dmesg` parse verified: `[  485.092696][   T63] qcom_q6v5_pas 4080000.remoteproc-mss: fatal error received: ...` -> `485`; `/proc/uptime` 1738 at the time.
- Fix: widen the detection window by the known detection lag and measure the hold from the crash, not from hold start. E.g. in `ssr_in_progress` use `window = CFG_SSR_GRACE + CFG_FAIL_THRESHOLD * ${CQ_INTERVAL_SEC:-5} + 2 * CFG_CHECK_INTERVAL`, and in `ssr_hold_gate` set the hold deadline to `crash_ts + CFG_SSR_GRACE` (store `crash_ts` from the dmesg parse) so a late detection holds only for the remaining grace. Document the interaction with the ping profile.

### WD-06 Token bucket is wall-clock; the RTC is 1970 on every boot

- Evidence (live): `/sys/class/rtc/rtc0/date` = `1970-01-01`, `since_epoch` = 2243 = uptime (the RTC does not keep time; `schedule_guard.sh:5` and `derive.ts:92` say the same). `date +%s` is only plausible after NITZ/ntpd, which needs the data path that is, by assumption, down when Tier 4 fires.
- Live synthetic (awk exactly as daemon:505): with three `tier4_escalation` rows days old and the clock at 1970+90 s the count is 3 (`overcount=3`); three rows written while the clock read about 1970+700 s and the clock later synced give 0 (`undercount=0`).
- Failure scenario: after a Tier-4 reboot the daemon starts with the clock at 1970; `count_recent_reboots` counts every row in the ledger (up to 20, any age). If three older rows exist, the next Tier-4 attempt in an unsynced session permanently auto-disables the watchdog (UCI `enabled=0`) instead of rebooting. Conversely rows stamped in the unsynced window look ancient after sync and stop counting.
- Fix: gate on clock plausibility. When `now < 1700000000` (same `_AE_SANE_EPOCH` the alert engine uses) count only rows whose epoch is also `< 1700000000` (rows written in this or earlier unsynced sessions); otherwise count rows with `$1 >= now-3600` as today. Sketch (also adds a numeric guard on `$1`):

```sh
count=$(awk -v now="$now" -F'|' '
    BEGIN { ok = (now >= 1700000000); cutoff = now - 3600 }
    $3 == "tier4_escalation" && $1 ~ /^[0-9]+$/ {
        if (ok) { if ($1 >= cutoff) n++ }
        else if ($1 < 1700000000) n++
    }
    END { print n+0 }' "$CRASH_LOG" 2>/dev/null)
```

  Same pattern should be applied to `alert_engine` readers of the same ledger (separate auditor).

### WD-07 Bucket fails open when the ledger cannot be written

- Evidence: daemon:889 `echo "${ts}|reboot|tier4_escalation" >> "$CRASH_LOG"` is unchecked, followed straight by the reboot. `count_recent_reboots` falls back to 0 on any awk failure. Live: `/etc` is `ubifs ... assert=read-only`, i.e. a UBIFS assertion failure remounts it read-only. A read-only or full `/etc` means the row is never recorded, `reboots_this_hour` stays 0 forever and the daemon reboots on every ladder completion, unbounded.
- Fix: check the append (`if ! echo ... >> "$CRASH_LOG"; then` log error, treat as exhausted: disable and do not reboot), and re-read the file after the append to confirm the new row is counted. Keep the existing `sync`.

### WD-08 SIGTERM does not terminate the daemon

- Evidence (live, BusyBox v1.36.1 ash): `sh -c 'trap "echo TRAP_RAN" TERM; kill -TERM $$; echo AFTER_TRAP_STILL_RUNNING'` prints both lines, i.e. the shell continues after the trap; and a trap raised during a foreground `sleep 4` runs only when the sleep ends (`TRAP_AT=4`). The daemon installs `trap '... write_state' EXIT INT TERM` (daemon:1434) with no `exit`. procd `term_timeout` is 5 s (live), `sleep` is `CHECK_INTERVAL` (10 s default).
- Consequences: (1) `stop`/`restart` always ends in SIGKILL after 5 s, so the trap's cleanup mostly never runs (init `stop_service` compensates for the PID file and recovery flag); (2) if the TERM lands during an action, the action keeps executing for up to 5 s then is killed mid-sequence (e.g. between `CFUN=0` and `CFUN=1`, or between `QUIMSLOT` and finalization: modem left offline or on the backup SIM with no record); (3) the trap removes the PID file while the process is still alive for those seconds, so a respawn could start a second instance.
- Fix: `trap 'exit 143' TERM; trap 'exit 130' INT; trap 'cleanup' EXIT` (cleanup does the rm + `write_state`), and make the waits interruptible (`sleep "$n" & wait $!`). Optionally refuse to be interrupted between `CFUN=0` and `CFUN=1` by finishing the sequence in a subshell, or at least `qcmd 'AT+CFUN=1'` in the cleanup when a radio-off marker is set.

### WD-09 Every settings save restarts the daemon

- Evidence: `watchdog.sh:511-515` does `touch RELOAD_FLAG` and `enable` + `restart` (fire-and-forget) on every save with `enabled=1`; the daemon already supports `RELOAD_FLAG` (daemon:1508), so the restart is redundant for a running daemon. With WD-08 the restart is a SIGKILL after 5 s.
- Consequences: in-memory state is lost: `failure_counter`, active cooldown, `current_tier`, `total_recoveries`, `last_recovery_time/tier` (the status card's "last recovery" resets to none on any save), `last_recheck_time`, and a not-yet-finalized Tier-3 swap (the failover record is only written at finalize, daemon:1068-1076), so a save during the 90 s settle strands the modem on the backup SIM; the new instance reads no record and the next outage skips Tier 3 as "backup == current". Plus 30 s of `BOOT_SETTLE` blindness and the 5 s `RECOVERY_FLAG` window being cleared by `stop_service`.
- Fix: in the CGI, only `start` when the service is not running (`pgrep`/`ubus service list`), otherwise rely on the reload flag; keep `restart` only for `enabled` 0->1 transitions. In the daemon, persist `total_recoveries` and `last_recovery_*` (carry them from the previous state file when its `boot_id`/mono shows the same boot) so a restart is not amnesiac.

### WD-10 `check_locked` ignores the SIM-switch flag and has no staleness bound

- Evidence: the poller backs off on `/tmp/qmanager_sim_switch_active` with an age guard (`SIM_SWITCH_MAX_AGE`, poller:2631-2644) because `cellular/settings.sh:422-423` holds that flag for the whole user SIM switch (`CFUN` procedure + `QUIMSLOT` verify + profile apply, which is a 15-60 s outage). The watchdog does not look at it.
- Failure scenario: a user SIM switch while `streak_fail` is already counting (or starts counting; `quiet` x5 = 50 s) can trigger Tier 1/2/3 concurrently with the switch (two actors driving `CFUN`/`QUIMSLOT`), or Tier 3 swapping the SIM the user just selected.
- Also: none of the lock sources has an age or owner check. `LONG_RUNNING_FLAG` and a reused PID in `PROFILE_APPLY_PID` (`kill -0` only) can hold the daemon in `locked` indefinitely (SUSPECTED; the flag is cleared at boot by init.d `qmanager:92` and by its owners' traps in normal operation). The daemon logs nothing while locked beyond entry.
- Fix: add the SIM-switch flag to `check_locked` with the same max-age rule as the poller; add a generous max lock age (for example 15 min by mtime for flag-type locks, `/proc/$pid/cmdline` match for PID locks) after which the daemon logs a warning and resumes.

### WD-11 Revert runs before the lock check

- Evidence: main loop calls `check_revert_request` (daemon:1521) before `check_locked` (daemon:1524). The revert path guards only against `recovery|cooldown` (daemon:1372), not `locked`, so it runs `sim_failover_fallback` (`CFUN=0`, `QUIMSLOT`, `CFUN=1`, profile auto-apply) while a scan, installer lock or profile apply owns the modem. Also reachable when state is `locked` and `sim_failover_active=true`.
- Fix: swap the order (lock check first, `continue` while locked) or add `[ "$state" = "locked" ]` to the defer condition.

### WD-12 Aborted Tier 3 is recorded as a moved slot

- Evidence: `execute_tier3` sets `original_sim_slot="$current_slot"` (daemon:691) before `AT+CFUN=0`; if `CFUN=0` fails it returns 0 ("action attempted") with `current_sim_slot` still `"null"` (daemon:711-716). `finalize_sim_failover` guards (daemon:1040-1042) are `current_tier==3`, `current_sim_slot != original_sim_slot`, `original != null`; `"null" != "1"` passes, so on a later successful cooldown it writes a failover record `{active:true, original_slot:1, current_slot:null}` and sets `sim_failover_active=true` although no swap happened; `_cooldown_handle_failure` (daemon:1005) likewise calls `sim_failover_fallback` (another full CFUN cycle) for a swap that never started. `check_revert_request` branch 2 (daemon:1406) also keeps a user revert pending forever. (LOCKED exit already special-cases `current_sim_slot != "null"`, daemon:1567, so the author knew.)
- Fix: add `[ "$current_sim_slot" != "null" ] ||` to all three guards, or set `original_sim_slot` only after the swap succeeds and reset it to `"null"` on the abort path. Handed to the SIM-failover auditor.

### WD-13 `write_state` has no failure guard

- Evidence: daemon:271-309: `jq ... > "$STATE_TMP"` then an unconditional `mv`. Live: `jq -n -c --argjson e "yes" '{a:$e}' | wc -c` = 0 bytes with the error on stderr. Inputs reaching `--argjson` from outside the daemon: `CFG_ENABLED` and `CFG_QUALITY_ENABLED` (raw UCI strings), `original_sim_slot`/`current_sim_slot` (parsed from `AT+QUIMSLOT?` output and from `jq` of the failover file). Any non-JSON value leaves a 0-byte `/tmp/qmanager_watchcat.json`, which the poller treats as "no data" (`_wdata` empty, fields keep old values) and the CGI embeds as `status` (empty `--argjson` -> the GET fails).
- Fix: `jq ... > "$STATE_TMP" && [ -s "$STATE_TMP" ] && mv "$STATE_TMP" "$STATE_FILE" || rm -f "$STATE_TMP"`; coerce `CFG_ENABLED`/slot values with a `case` digit check before `--argjson`. Also use `qm_atomic_write` like `finalize_sim_failover` does for symlink-safe writes (fixed `.tmp` name in `/tmp`, see WD-21).

### WD-14 Frozen `cooldown_remaining`

- Evidence: LOCKED entry (daemon:1525-1543) never sets `cooldown_remaining=0`. Entering `locked` during a cooldown leaves e.g. 40, shown in `locked` and then in `monitor` after exit (daemon:1550-1559 also does not reset it). `deriveBand` treats `cooldown_remaining > 0` as "cooling" (derive.ts:249) and renders a countdown in a non-cooldown phase until the next cooldown overwrites it.
- Fix: `cooldown_remaining=0` on LOCKED entry, in the natural-recovery reset, and wherever `state="monitor"` is assigned after a cooldown.

### WD-15 Stale `current_tier` after SSR natural recovery

- Evidence: the reachability branch calls `find_next_tier 1` BEFORE `ssr_hold_gate` (daemon:1655-1664). If the hold starts and connectivity returns, the natural-recovery arm (daemon:1633-1642) resets `failure_counter`, quality counter, flags, but not `current_tier`. The next episode skips `find_next_tier 1` (`current_tier` != 0), so a Tier-1 disabled in the meantime (via reload) still runs, and the state file shows a non-zero tier while in `monitor`. (The quality branch calls `ssr_hold_gate` first, so it is unaffected.)
- Fix: `current_tier=0` in the natural-recovery arm, or call `find_next_tier` after the gate.

### WD-16 All tiers disabled

- Evidence: `find_next_tier 1` returns 1 and leaves `current_tier=0`; `do_recovery` then matches no `case` arm with `action_result=0`, counts a "recovery", logs "Tier 0", sets `last_recovery_tier=0`, `total_recoveries++`, enters cooldown; `finish_cooldown` fails the test -> `find_next_tier 1` fails -> "exhausted" -> `monitor`; streak still above threshold -> repeats every `cooldown + 2*interval`. Each pass emits two events and holds `RECOVERY_FLAG` (suppresses poller events) for most of the time. The CGI does not reject an all-tiers-off save (no such check in `watchdog.sh`); whether the form blocks it was not verified.
- Fix: in `do_recovery`/the entry sites, bail out when `find_next_tier` fails (log once, stay in `monitor`, do not touch counters or the recovery flag), and reject the combination in the CGI.

### WD-17 Auto-disable path

- Evidence: comment daemon:879 "procd won't respawn since UCI disabled" is wrong: procd respawns on any exit (live `respawn: threshold 3600, timeout 5, retry 5`); the init script's `enabled` guard runs only on `start`, not on respawn. The respawned instance runs `read_config` -> `enabled=0` -> `exit 0` (daemon:1439-1442) and its EXIT trap calls `write_state` with the default `state="monitor"`, overwriting the `disabled` state (the UI still shows `auto_disabled` because the CGI flag outranks it). Five of these burn the respawn budget. The reason for the disable (DISABLED_FLAG in tmpfs, event in tmpfs) is lost at the next reboot, after which the page just says "off" (doc line 751 only promises the UCI flip persists).
- Fix: after the UCI disable, call `/etc/init.d/qmanager_watchcat stop` semantics (or `procd` `ubus call service delete`) instead of bare `exit 0`, or make the early `exit 0` path skip `write_state` when `CFG_ENABLED!=1`. Persist the reason: `uci set quecmanager.watchcat.auto_disabled_at=<epoch>` plus the bucket numbers, cleared by the CGI on re-enable, and drive `auto_disabled` from it.

### WD-18 Tier 1 and Tier 2 side effects (SUSPECTED)

- Tier 1 ends with `AT+COPS=0` (automatic). A user or profile who selected a manual operator (`COPS=1,2,"<plmn>"`, see the SIM-PLMN lock in `docs/reference/cell-scanner.md`) is silently switched to automatic. Fix: read `AT+COPS?` first and restore the same mode/operator.
- Tier 2 sends `AT+CFUN=1` with the result discarded (daemon:657) and waits only for a bare `AT`; if `CFUN=1` loses to lock contention the radio stays off until a later tier or the next ladder. Fix: verify `AT+CFUN?` = 1 and retry 3x (also applies to the Tier-3 and recheck sequences).

### WD-19 Config reload and validation

- `read_config` only assigns when the UCI key is non-empty (`[ -n "$val" ] && ...`), so deleting a key (config restore, manual) keeps the previous in-memory value instead of the default.
- No numeric validation for `check_interval`, `cooldown`, `max_reboots_per_hour`, `quality_consecutive`, `ssr_grace`. Live: `sleep abc` exits 1 immediately (tight loop with a jq fork per pass) and `[ x -ge 3 ]` returns 2 (silently false, so a garbage `max_reboots_per_hour` disables the bucket). Only reachable by hand-editing UCI (the CGI validates), hence low.
- Fix: one `case` digit check per numeric key with the default fallback already used for `fail_threshold`.

### WD-20 No backoff between exhausted ladders

- With Tier 4 disabled (test unit) or skipped, a persistent outage cycles Tier 1 -> 2 (-> 3) -> exhausted -> 20 s -> Tier 1 ... forever: `COPS` + `CFUN` radio cycles every few minutes (for example no coverage, SIM removed). The only escalation cap is the Tier-4 bucket. Fix: after an exhausted ladder wait an escalating hold-off (for example 5, 10, 20, 30 min, reset on success) before the next ladder and say so in the UI blurb.

### WD-21 Process hygiene

- PID guard (daemon:1422-1430) trusts `kill -0 $pid`; a recycled PID after a SIGKILL makes every respawn exit 1 until procd's retry budget is gone (daemon silently not running; ties to WD-04). Check `/proc/$pid/cmdline` for `qmanager_watchcat`.
- `main` does not clear a stale `RECOVERY_FLAG` at start; after a SIGKILL/crash mid-cooldown, `qmanager_ping` reports `during_recovery=true` and the poller's event/alert suppression stays on until the next recovery cycle (init `stop_service` covers only the stop path).
- `STATE_TMP`, `PID_FILE` use fixed names in world-writable `/tmp`; the repo has `safe_tmp.sh` (`qm_atomic_write`) for this class (docs/reference/safe-tmp.md) and uses it for the failover file but not for the state file.

### WD-22 Events

- `append_event` (events.sh:33-52) appends and trims (`tail > tmp; mv`) with no lock, from two processes (poller and watchcat). A trim in one process can drop an append from the other. Low frequency, but the watchdog is exactly the writer whose rows matter.
- Ring of 50 shared with chatty types (see WD-01 section); consider per-type retention or the dedicated persistent ledger above.

### WD-23 `q_packet_loss` coercion

- daemon:399 maps any non-digit (including `12.5`) to 0. Today the poller emits an int (`int(lost*100/n)`, poller:1623), so this is defensive: truncate at the dot rather than zeroing if the type ever changes (`${q_packet_loss%%.*}`).

### WD-24 SIM failover state is tmpfs (cross-ref)

- Evidence: `SIM_FAILOVER_FILE=/tmp/qmanager_sim_failover` and `/tmp` is `tmpfs` (live `mount`). The "stale SIM failover state from before reboot" block (daemon:1452-1491) can therefore only fire on a daemon restart (procd respawn or settings save), never after a reboot. After any reboot while on the backup SIM the daemon starts with `sim_failover_active=false`, `original_sim_slot=null`: no banner, no revert, no auto-failback, and Tier 3 later skips because backup == current. The slot itself persists in the modem. Also the resume check queries `AT+QUIMSLOT?` before `BOOT_SETTLE`, and an empty reply (modem not ready) deletes the record (daemon:1486-1489).
- Fix belongs to the SIM-failover audit: persist the record in `/etc/qmanager` (with the `sim_db` ICCIDs it already holds) and retry the live-slot read.

---------------------------------------------------------------------------

## 3. Live evidence captured (read-only)

- Daemon identical to repo: `md5sum /usr/bin/qmanager_watchcat` = `ae4076a8919e0ca303b555504efb1211` = repo file; 1715 lines.
- UCI: `watchcat.enabled='0'`, `tier4_enabled='0'`, `quality_enabled='1'`, `quality_consecutive='5'`, `fail_threshold='5'`, `check_interval='10'`, `cooldown='60'`, `ssr_aware='1'`, `ssr_grace='45'`; `quality_thresholds`: latency custom 800, loss custom 20. No daemon in `ps`; no `/tmp/qmanager_watchcat.json`; poller reports `{"enabled":false,"state":"disabled",...}` for the missing file.
- Ping cache: `profile=quiet interval_sec=10 fail_secs=30 reachable=true streak_fail=0`, `mono` present (conn_state staleness uses monotonic).
- `status.json`: `connectivity.packet_loss_pct=8`, `latency_history` 60 entries with 5 nulls, `history_interval_sec=10`, `network.cfun` present.
- `crash.log`: 20 rows, all `user`/`unplanned`, zero `tier4_escalation` (`live_count=0`). Timestamps are plausible now; RTC reads 1970 (uptime-driven).
- Events ring: 20 rows in 25 min, 12 `ca_change`.
- procd: `term_timeout 5`, `respawn {3600, 5, 5}` (qmanager_atd instance; same parameters in the watchcat init script).
- Mounts: `/tmp` tmpfs; `/etc` `ubifs ... assert=read-only`.
- BusyBox ash trap behaviour and `jq --argjson` failure: reproduced with inline `sh -c` / `jq -n` (no files created).
- SSR parse: dmesg line `[  485.092696][   T63] qcom_q6v5_pas 4080000.remoteproc-mss: fatal error received: ...` -> the daemon's `sed` yields `485`.
- Synthetic bucket test: `overcount=3`, `undercount=0` (see WD-06).
- One probe was refused by the bridge deny-list because a literal `reboot` appeared inside a `printf` argument; rerun with a neutral field value.

---------------------------------------------------------------------------

## 4. Documentation vs code drift (`docs/features/connection-watchdog.md`)

1. Line ~369: `reboots_this_hour` described as "in the last 3600s" (rolling). Code recounts only at start and inside Tier 4 (WD-01); `derive.ts:297` already admits "running total since start".
2. State-machine diagram (doc ~lines 130-150): shows escalation as `find_next_tier -> SUSPECT (re-enter)`. Code escalates directly (`_cooldown_handle_failure` -> `do_recovery`, daemon:1009-1022, with a comment explaining why).
3. "Dual-Trigger Model": "rises above `fail_threshold`"; the code is `>=` (daemon:1649). The UCI table wording ("consecutive failed probes before ... fires") is right.
4. Known Gotchas warning about `read_ping` ("single batched `jq -r ... @tsv` call into `_pdata` ... `cut -f` columns, `.mono` separate"): obsolete. `read_ping` is now a thin wrapper over `conn_state_read` (daemon:357-376; `conn_state.sh` is the one jq read with `s` helper). `read_quality` is the only remaining multi-jq reader.
5. Data-source section 2 says quality freshness is "judged from the root `.timestamp` field against `STATUS_STALE_THRESHOLD=30`". Code prefers the monotonic `.mono` and uses wall-clock only as fallback (daemon:400-421).
6. "Recovery-Lifecycle Network Events" table: says the start event's "reason field carries unreachable|quality" and that "Recovery exhausted" is "written when the ladder reaches Tier 4 and auto-disables". Events have only `{timestamp,type,message,severity}`; the reason is inside the message text (daemon:948-950). "Recovery exhausted" is emitted by `_cooldown_handle_failure` (daemon:1025) when ALL enabled tiers were tried (any ladder height); the auto-disable emits a different message (daemon:867). Not listed: SSR-hold, escalation and per-tier events.
7. Quick Reference "Reboot?" row: `sleep 1 && reboot`; code is `sleep 1; sync; reboot` (daemon:908). The `sync` is correct and should be documented (also `docs/architecture/persistent-writes-sweep.md` row 1 still claims "the row is lost in exactly the window before a reboot", which the `sync` addresses).
8. Known Gotcha "Auto-disable persists across reboots (UCI) ... procd is configured to do so (the init.d script checks `enabled`)": incomplete. See WD-17 (procd respawn after the exit, state overwrite, flag and reason lost at reboot).
9. State table `total_recoveries`: "since daemon start" is right but should say per tier action and that every settings save restarts the daemon (WD-09), so the figure and `last_recovery_*` reset on each save.
10. `failure_count` described as "Reachability failure counter"; it is a display mirror of the raw ping `streak_fail`, frozen during cooldown/locked, and not an accumulator (comment daemon:1618-1621).
11. State list omits that `recovery` is never visible in the file, and that `disabled` is also written on a reload-disable exit (daemon:1514).
12. Not documented: `BOOT_SETTLE=30`, `MODEM_WAIT_TIMEOUT=60`, no AT timeouts, cooldown measured in loop passes, stale-ping extension of up to 3 intervals in cooldown, cooldown stale-ping failure escalating to the next tier, the 20-row `crash.log` trim, the daemon default `enabled=1` when the UCI key is absent (doc says 0), re-enable-inside-the-hour behaviour of the bucket, Tier 2 `AT+CFUN=1` unverified, and the missing airplane-mode/SIM-switch guards (WD-03, WD-10).
13. Comment at daemon:1452 ("stale SIM failover state from before reboot") and the doc imply the failover record survives a reboot; it is in tmpfs (WD-24).
14. "Revert semantics" table: lists branches but not that revert is processed before the lock check (WD-11).
15. SSR section says the hold is measured "within `CFG_SSR_GRACE` seconds of now" without the detection-lag caveat (WD-05).

---------------------------------------------------------------------------

## 5. Hygiene checks passed

- CRLF: `.claude/check-crlf.sh` reports LF; file ends with a newline.
- No bashisms found (`[[`, `(( ))`, `==` inside `[ ]`, `local a b`, arrays, `echo -e`, here-strings). All `local` declarations are single-variable.
- No jq regex (`test/match/sub/gsub`) in the daemon or `conn_state.sh`; null-handling uses `if . == null` throughout.
- State file write is tmp+`mv` on the same tmpfs (atomic for the poller's reader).
- Float handling in `quality_breached` uses awk (correct); integer compares are guarded with `2>/dev/null` where the value can be empty.
- Tier 4 reboot path flushes: `crash.log` append, trim, `write_state`, then `( sleep 1; sync; reboot ) &` (reboot is plain busybox, no wrapper); the background subshell does not inherit the EXIT trap (ash resets traps in subshells).
- Cooldown uses loop-pass counting and `/proc/uptime`; ping staleness is monotonic. The only wall-clock uses are display timestamps (`last_recovery_time`, `timestamp`) and the Tier-4 ledger (WD-06).

---------------------------------------------------------------------------

## 6. Suggested order of work

1. WD-02 (quality window), WD-03 (airplane mode), WD-04 (dead/blind daemon visibility): wrong or invisible behaviour on realistic paths.
2. WD-01 + the persistent reboot feed + WD-06 + WD-07 together (one change set around `count_recent_reboots`, `crash.log` and the CGI `recent_reboots`).
3. WD-08 + WD-09 (signal handling and restart on save), WD-05 (SSR window), WD-10/11/12 (locks and SIM interaction).
4. Low items as a hardening pass (WD-13..WD-23), then update the doc (section 4).

Lifecycle lockstep reminder for any change that adds persistent files (`/etc/qmanager/watchdog_events.ndjson`, UCI `auto_disabled_at`): `install.sh` seed, update migration, uninstall cleanup (keep-config vs purge), and the `/tmp` flag cleanup list.
