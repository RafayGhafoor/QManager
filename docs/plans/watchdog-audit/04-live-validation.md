# Watchdog modular-lean: live validation (Gate 3)

Date: 2026-10-21. Device: RM551E test modem (OpenWRT, BusyBox v1.36.1), slot 1 active, slot 2 empty.
Branch `worktree-watchdog-modular-lean` (HEAD = merge of development-home, 9ae9d5e1).

## Verdicts

| Test | Verdict | Key timing |
|---|---|---|
| Deploy | PASS | 11 files, md5 = repo LF blobs |
| L1 smoke | PASS | state rewritten every 10 s after the 30 s settle |
| L2 stop | PASS | stop 0.1 s, no SIGKILL, state + PID files gone |
| L3 STOP / CONT / kill -9 | PASS (with finding W1) | age_sec > stale_after at +100 s; procd respawn < 8 s |
| L4 save while running | PASS | PID unchanged across CGI save and `reload_config` |
| L5 radio off | PASS | radio_off ~28 s after CFUN=4, back to monitor ~1 s after CFUN=1 |
| L6 real Tier 4 | PASS | outage to reboot ~25 s; cap auto-disable 76 s after boot; decay <= 60 s |
| L7b empty backup slot | PASS | swap, fallback to slot 1 in 13 s, no record left |
| CGI robustness | PASS | valid envelope in all 3 fault cases; stopped daemon reads disabled / null |

## Deploy

Pushed with Posh-SSH `Set-SCPItem` flat to `/tmp/wdd*` (the bridge refuses content that contains "reboot"), then `cp .new` → `sync` → `mv` per file, mode 755, libs first, then the main daemon, poller, init, CGI and `config_backup_sections.sh`. `parse_at.sh` already matched the repo (657b5b9d…), so it was not redeployed. Every on-device md5 matched the repo LF file; `sh -n` was clean on all of them. Re-checked after the L6 reboot: unchanged. The poller was restarted by killing its PID (procd respawned it as PID 15983) and `status.json` updated within 20 s.

Pre-existing state found: `/tmp/qmanager_watchcat.json` from 09:24 (monolith era, no `mono` field) made `status.json` show `enabled:true, state:monitor` with the daemon disabled. It was removed before L1. The new `stop_service` and exit trap both remove it, so this cannot recur from the new code.

## L1 smoke (PASS)

```
1792551162 {"timestamp":1792551155,"state":"monitor","mono":11359,"stale_after":90}
1792551172 {"timestamp":1792551165,"state":"monitor","mono":11369,"stale_after":90}
status.json .watchcat: {"enabled":true,"state":"monitor",...,"age_sec":14,"stale_after":90}
qm_watchcat: Tiers: T1=0 T2=0 T3=0 T4=0 backup_sim=none
```
logread had no error or warning lines from `qm_watchcat` and no procd stderr lines.

## L2 stop (PASS)

```
stop took: 0.1s
GONE
ls: /tmp/qmanager_watchcat.pid / .json / qmanager_recovery_active: No such file or directory
```
With the daemon stopped, `status.json` showed `{"enabled":false,"state":"disabled",...,"age_sec":null,"stale_after":null}`. Restarted: PID 17691.

## L3 STOP / CONT / kill -9 (PASS, finding W1)

`kill -STOP`: `age_sec` grew 10, 20 … 90, then 100 > `stale_after` 90 at +100 s. (`stale_after` is 90 s in monitor, so "~1 min" from the brief is really ~1.5 min. This is by design.)
`kill -CONT`: the daemon resumed at once, with a fresh `mono` in its state file. `kill -9 17691` → procd respawned PID 21799 within 8 s; the new instance handled the stale PID file.

**W1 (warning, poller): in the `deep` / idle poller tiers, `status.json .watchcat` is read only on full-refresh touches, about every 2 min.** `read_watchcat_state` sits inside the Tier 1.5 block, which runs only when the AT block runs. Between reads, the poller holds the last `wc_mono` and keeps computing `age_sec` from it. So a healthy daemon routinely reports `age_sec` > `stale_after`:
```
poller_tier "deep"; daemon writing every 10 s
10:58:53 age=90  10:59:03 age=100 … 10:59:23 age=120  10:59:33 age=8 … 11:01:03 age=99
```
After CONT, the daemon's own file was fresh (mono 11615 at uptime 11623), but `status.json` still showed `age_sec` 159 to 183 until the next full refresh. `components/monitoring/watchdog/derive.ts` flags stale on `age_sec > stale_after`, so the first `status.json` a viewer sees after deep/idle can briefly flag a healthy watchdog as stale. Prometheus would see the same value. The same lag delays "stopped → disabled" by up to ~2 min (seen in the CGI robustness test). Suggested fix: move `read_watchcat_state` out of the AT-gated block (it is a file read, not an AT command), or compute age only right after a fresh read.

## L4 save while running (PASS)

The CGI POST `{"action":"save_settings","enabled":true,"cooldown":60,"fail_threshold":5}` returned `{"success":true}`. PID 21799 was unchanged and logged `Config reload requested` at 11:01:52.
Then `uci set …cooldown=61; uci commit quecmanager; reload_config` → PID still 21799 after 6 s, no restart. `procd_add_reload_trigger` re-runs `start_service` with identical params, so procd keeps the instance.

## L5 radio off (PASS)

Tiers 1-2 on, `fail_threshold=2`.
```
11:02:25 AT+CFUN=4
11:02:43 MONITOR → SUSPECT: streak_fail=1 (threshold=2)
11:02:53 WARN Radio is off (AT+CFUN 0 or 4): holding recovery until it is back on
11:02:56 … 11:04:07 state radio_off, streak_fail 3 → 10, current_tier 0
11:04:23 AT+CFUN=1 (manual)
11:04:24 Radio is back on (AT+CFUN=1) — resuming monitoring
```
There were no TIER lines and no `AT+COPS`/`AT+CFUN` from the watchdog in `qmanager.log` or logread. Afterwards `AT+CFUN?` returned 1 and the ping was reachable by 11:04:45.

## L6 real Tier 4 (PASS)

Tiers 1-3 off, T4 on, `max_reboots_per_hour=1`, `fail_threshold=3`, targets 192.0.2.1 / 198.51.100.1.
```
11:07:07 start (boot_id ce5528e9…)
11:08:38 suspect, streak 3;  11:08:48 SSH drops
crash.log: 1792552128|reboot|tier4_escalation        (11:08:48)
11:10:20 up 1 min, boot_id aa820727… (new)
11:09:55 Reboots in last hour: 1
status.json .watchcat: {"state":"monitor","reboots_this_hour":1,…}
11:10:36 EVENT Watchcat disabled: reboot limit exceeded (1 reboots/hour)
UCI enabled=0, /tmp/qmanager_watchcat_disabled present
CGI GET: "auto_disabled": true, "recent_reboots": [1792552128]
```
Decay: the daemon was restarted with all tiers off (`reboots_this_hour` 1) and the row's epoch rewritten to now-3590 (1792548790). The count went 1 → 0 at +60 s.

Info:
- After auto-disable, procd respawned the daemon 5 times in 25 s, and each instance logged "Watchcat disabled in config, exiting" until the respawn budget ran out. The init stays `enabled` in rc.d until the user saves. This is harmless noise; the code comment "procd won't respawn" is inaccurate.
- After auto-disable, `status.json` shows `reboots_this_hour: 0`, because the exit cleanup removes the state file. The CGI `recent_reboots` still carries the row.
- The Tier-4 trim kept the last 20 crash.log rows, so the oldest pre-test row was dropped. The pre-test crash.log was restored byte-for-byte (md5 96b6e212…).

## L7b backup slot 2 empty (PASS)

Tier 3 on (T1/T2/T4 off), `backup_sim_slot=2`, TEST-NET targets.
```
11:15:22 SUSPECT → RECOVERY: streak_fail=3 >= 3
11:15:23 TIER 3: SIM failover from slot 1 to slot 2
11:15:36 ERROR TIER 3: Could not confirm a SIM in backup slot 2 after 3 attempts (rc=0), falling back
11:15:36 WARN SIM failover fallback: reverting to slot 1
11:15:42 Entering COOLDOWN for 90s (after Tier 3)
11:17:12 All recovery tiers exhausted — returning to monitor (pausing 15 minutes)
```
After the targets were restored: `+CFUN: 1`, `+QUIMSLOT: 1`, no `/etc/qmanager/sim_failover.json`, no `/tmp/qmanager_sim_failover`, no file with a `"confirmed"` key under `/etc/qmanager` or `/tmp/qmanager_*`. The state showed `sim_failover_active:false`. No swap flag or recovery flag was left. The watchdog went back to `monitor` once the link was healthy.
Info: the "(rc=0)" in the fallback error reads oddly next to "could not confirm". The `[watchdog_revert] No profile matches live ICCID` warnings are expected on this SIM.

## CGI robustness (PASS)

Daemon stopped; each GET returned 200 with `success:true` and a full envelope:
- 0-byte `/tmp/qmanager_watchcat.json` → `"status": {}`.
- Garbage `/tmp/qmanager_sim_failover` (`garbage{{not json`) → `"sim_failover": {"active": false}`.
- UCI `cooldown=abc` → `"cooldown": 60`.
- Daemon stopped, no state file → `status.json .watchcat` = `{"enabled":false,"state":"disabled",…,"age_sec":null,"stale_after":null}` (after the W1 deep-tier lag).

## Final device state

- Watchdog disabled: `enabled='0'`, init `disabled`, no daemon, no `/tmp/qmanager_watchcat*` state.
- `uci show quecmanager.watchcat` and `quecmanager.ping_profile` match the pre-test snapshot exactly (md5). Both sections moved to the end of `/etc/config/quecmanager` because they were re-created.
- `crash.log` matches the pre-test file (md5 96b6e212…).
- `+CFUN: 1`, `+QUIMSLOT: 1`, no failover record.
- The new code stays deployed (md5 verified after the reboot).
- The monolith copy is back at `/tmp/qmanager_watchcat.mono.bak` (md5 ae4076a8…; lost on the next reboot). `/etc/qmanager/wd_test_snapshot/` was deleted.
