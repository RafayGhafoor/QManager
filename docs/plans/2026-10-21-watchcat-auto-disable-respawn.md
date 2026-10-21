# Plan: stop the procd respawn loop after the watchdog disables itself

## Problem
After Tier 4 reaches `max_reboots_per_hour`, `execute_tier4` (`wd_tiers.sh`) sets UCI
`enabled=0`, touches `/tmp/qmanager_watchcat_disabled` and exits 0. procd respawns any exit,
whatever the code (`respawn 3600 5 5`: a run shorter than 3600 s counts as a failure, 5 s
delay, up to 5 retries). Each respawn reads `enabled=0`, logs "Watchcat disabled in config,
exiting" and exits again, five times in 25 s, until procd gives up. The init script also stays
enabled in `/etc/rc.d` until the user saves the settings. The comment "procd won't respawn
since UCI disabled" is wrong: `start_service`'s UCI gate runs only on start or restart.
procd re-runs the command directly on respawn.

Device (read-only, today): the init file matches the repo, and `ubus call service list` has no
instance because the watchdog is disabled.

## Approach (option a: retire the service the way the UI does)
Turning the watchdog off from the UI runs `/etc/init.d/qmanager_watchcat stop` and then
`disable` (`monitoring/watchdog.sh`). The daemon will do the same when it turns itself off:

1. New `wd_retire_service` in `wd_tiers.sh`: `/etc/init.d/qmanager_watchcat disable`, then
   `/etc/init.d/qmanager_watchcat stop`. `stop` removes the procd instance
   (`ubus call service delete`), so procd sends TERM and does **not** respawn. The daemon is
   waiting on the init script as a foreground child, so the TERM trap (`exit 143`) runs when
   the script returns, and `_wd_exit_cleanup` runs once from EXIT, as it does for a UI stop.
   `term_timeout 15` gives plenty of room.
2. `execute_tier4` auto-disable: after the UCI write, the flag and `write_state`, call
   `wd_retire_service`, then keep `exit 0` as the fallback when no procd is running (a manual
   run or the harness). Fix the comment.
3. Startup path `CFG_ENABLED != 1` ("Watchcat disabled in config, exiting") in `main`: call
   `wd_retire_service` too, so any start that finds UCI off ends the procd instance and leaves
   no rc.d link. This path is only reached when procd re-runs an instance whose UCI was turned
   off underneath it. The UI's own disable already stops the service.

Option b (idle-sleep while disabled) is rejected: a live process with `enabled=0` would change
what "Not reporting" means on the page and leave a daemon running that does nothing.

## Files
- `scripts/usr/lib/qmanager/wd_tiers.sh`: `wd_retire_service`, auto-disable call, comment.
- `scripts/usr/bin/qmanager_watchcat`: the startup disabled path calls it.
- `tools/watchdog-harness/`: stub `/etc/init.d/qmanager_watchcat` like the tower-failover stub
  (logs to `calls.log`). Scenario 16's `calls.log` gains `disable` and `stop` lines (an
  explained baseline change). New scenario 72: started with `enabled=0`, retires and exits.
  Scenario 71 covers item 3 (empty-slot CPIN reply in the log).
- Init script, `install.sh`, update and uninstall: **no change**. No new files, flags or UCI keys.
- Docs: `docs/features/connection-watchdog.md` (auto-disable now stops and disables the service;
  `reboots_this_hour` reads 0 after auto-disable, which is harmless because no consumer shows
  it in that phase).

## Risks
- The init script's `stop_service` removes `/tmp/qmanager_watchcat.json`, which the exit
  cleanup also removes. That is already the behaviour, and the disabled flag stays.
- If `stop` fails (ubus down), the daemon falls through to `exit 0`. That is today's behaviour,
  bounded by procd's 5 retries, and each retry tries to retire again.
- Re-enabling from the UI still works: the CGI runs `enable` and then `start` when nothing is
  running.

## Validation
- Static: `sh -n`, CRLF check, BusyBox audit. Harness: all IDENTICAL except the explained
  scenario 16 `calls.log` and the item-3 lines, plus new scenarios 71 and 72.
- Live (needs your OK, **it reboots the modem**): snapshot UCI. Use L6 from
  `docs/plans/watchdog-audit/04-live-validation.md`: tiers 1-3 off, T4 on,
  `max_reboots_per_hour=1`, ping targets 192.0.2.1 and 198.51.100.1. After one reboot and the
  cap, expect one "Auto-disabling" line with no "disabled in config" respawn lines,
  `ubus call service list` empty, no `/etc/rc.d/*qmanager_watchcat` link, and the page showing
  Auto-disabled. Restore UCI exactly and leave the watchdog disabled.
  Lighter check with no reboot, which covers the shared `wd_retire_service` path: set
  `enabled=1`, start the service, then commit `enabled=0` and `kill` the daemon PID. procd
  respawns it, the startup path retires it, and the log shows exactly one "disabled in config"
  line, with no instance or rc.d link left. Then restore UCI.

## Rollback
Revert the commit, then redeploy the two files and run `sync`.
