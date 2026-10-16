# Scheduled Jobs and the Clock-Step Guard (issue #9)

QManager's scheduled actions are BusyBox `crond` jobs in the single root crontab (`/etc/crontabs/root`). Each one is a marked line written by its CGI:

| Job | Worker | Written by | Schedule source the guard reads |
|---|---|---|---|
| Scheduled reboot | `qmanager_scheduled_reboot` | `system/settings.sh` | UCI `quecmanager.settings.sched_reboot_time` / `sched_reboot_days` |
| Low power enter / exit | `qmanager_low_power enter\|exit` | `system/settings.sh` | UCI `quecmanager.settings.low_power_start` / `low_power_days` (enter only) |
| Tower lock apply / clear | `qmanager_tower_schedule apply\|clear` | `tower/schedule.sh` | `/etc/qmanager/tower_lock.json` `.schedule.start_time` / `.end_time` / `.days` |
| Scenario transitions | `qmanager_scenario_schedule <id>` | `scenario_mgr.sh` | none (a multi-block timeline; clock + uptime only) |
| Auto-update | `qmanager_auto_update` | `system/update.sh` | UCI `quecmanager.update.auto_update_time` |

## Why a guard is needed

The RM551E has no RTC that keeps real time. The PMIC RTC (`rtc-pm8xxx`) counts from its own reset, so the kernel boots at 1970. Then `sysfixtime` sets the clock to the newest file mtime under `/etc`, which is often minutes or days stale. `time_daemon` (NITZ, after SIM registration) or `sysntpd` step it to real time later, at an unbounded moment. crond starts at ~35 s uptime.

On each wake, BusyBox crond compares the clock with its last wake. On a forward jump of up to 60 minutes, it runs **every job whose minute was crossed**. A jump over 60 minutes is logged as "time disparity" and runs nothing. So a boot whose stale clock reads just before a scheduled minute, and whose step lands just after it, fires that job. For the scheduled reboot this can loop, because each reboot lands the clock back before the minute. This is the RM551E form of the RM520N's issue #9 (there, systemd `OnCalendar` timers misfired on the step; source commits `96cc4e1e`, `25599f24`, `14b07359`).

## The guard (`scripts/usr/lib/qmanager/schedule_guard.sh`)

`_qm_timer_fire_allowed <HH:MM-or-empty> [days_csv]` allows a fire only if all of these hold:

1. **Clock sane:** the year is 2025 or later.
2. **Boot settled:** uptime is at least `QM_TIMER_SETTLE_SECS` (300 s). A clock step cannot move `/proc/uptime`, so this leg is required, never an escape.
3. **Day mask:** when one is given, today (`date +%w`) is in it.
4. **Minute match:** when a schedule minute is given, now is within `QM_SCHED_TOLERANCE_MIN` (2 min) of it, wrapping midnight. crond fires on the exact minute; the RM520N source uses 10 min for systemd timer accuracy.

On deny it sets `QM_GUARD_REASON`. The worker logs a warning (info for low power) and exits 0: a clean skip, never a failure. Every helper fails closed on an unparsable operand. HH:MM is converted with `awk`, never `$(( ))`, because zero-padded fields are octal in ash.

Rules for each worker:

- A worker that has a schedule time but cannot read it denies itself with `_qm_validate_hhmm` before calling the guard. An empty schedule passes the minute leg on purpose; that is for the scenario worker only.
- If the library is missing, every worker fails closed (skips), except `qmanager_scheduled_reboot`. It falls back to an inline uptime check: it reboots only past 300 s of uptime, and an unreadable uptime counts as 0.
- The scenario worker's deny is a plain skip. It must not fall through to the self-heal teardown, which is for a deactivated profile.
- `qmanager_low_power exit` is not guarded: restoring the radio is the safe direction, and it is already a no-op outside low power. The boot-time `qmanager_low_power_check` is a separate path; it is not cron-fired.
- Skips are not written to `/etc/qmanager/crash.log`. The watchdog's token bucket already counts only `tier4_escalation` rows.

Test hooks (for replay on the device, never in production): `QM_TIMER_GUARD_BYPASS=1`, `QM_TEST_YEAR`, `QM_TEST_UPTIME`, `QM_TEST_NOW_HHMM`, `QM_TEST_DOW`.

Replay verified on the RM551E (2026-10-16), live library sourced: a 04:00 job re-entering at uptime 26 s, a late step to 04:05 or 15:20, a 1970 clock, an off-mask day, and garbage uptime/year all DENY. A settled fire at 04:00, 04:01, 04:02, 23:59 against 00:00, and 08:09 all ALLOW.

## Related: the watchdog's auto-failback clock

`qmanager_watchcat` times the auto-failback primary recheck (`last_recheck_time`) with `mono_now` (seconds since boot), not epoch. A boot-time clock step can no longer make a recheck, which is a real outage, due at once after a resume from `/tmp/qmanager_sim_failover`.

## Known gaps

- `qmanager_low_power_check` decides at boot from the wall clock, which may still be the stale sysfixtime value at that moment.
- The scenario worker cannot match its minute, so a late clock step (after 300 s uptime) can still apply a scenario off-schedule. Scenario apply is non-destructive (mode preference plus band locks).
