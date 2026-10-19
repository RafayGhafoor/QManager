# B5.29 overnight monitor: how to read it

`overnight_monitor.sh` is a dev-only, unattended sampler for the B5.29 poller re-author. It was started on the test modem on 2026-10-18 at about 20:11 PHT (uptime 58245 s), right after Phase 1 was deployed, and stops by itself after 12 hours (about 08:11 PHT on 2026-10-19).

## Where things are on the modem

| What | Path |
|---|---|
| Monitor and sampler | `/tmp/pp/overnight_monitor.sh`, `/tmp/pp/measure.sh` |
| Output (one line per 5 min) | `/tmp/b529_mon/mon.log`, older lines in `/tmp/b529_mon/mon.log.1` (rotated at 256 KB) |
| PID while running | `/tmp/b529_mon/pid` (removed when it ends) |
| Backups of the pre-B5.29 files | `/usrdata/qmanager_bak_b529/*.orig`, md5s in `md5.orig.txt`; deployed md5s in `md5.b529.txt` |

`/tmp` is RAM: a reboot loses the log. A `# start` line without a matching `# end` line (and no pid file) means the monitor died early, probably from a reboot. Compare the last `up=` with the current `/proc/uptime`.

Stop it early: `kill "$(cat /tmp/b529_mon/pid)"`.

## Line format

```
ts=<epoch> up=<s> window=60s ticks=N cpu_pct_core=X forks_per_s=Y status_period_avg=Z min=.. max=..
  mono_age_max=.. tiers=active:a,idle:i,deep:d ... hb_age_min=.. hb_age_max=..
  fpc=<forks per cycle, upper bound> at_ms=<qcmd AT round trip> ssr=<total> ssr_new=<since start>
  poller_pid=.. atd_pid=.. log_fail=.. log_busy=.. log_unreach=.. log_watch=.. log_restart=.. log_reboot=..
```

- `cpu_pct_core`: the poller's CPU (with children) as a percent of one core over the 60 s window.
- `forks_per_s`: **system-wide** new processes per second, minus the sampler's own. It includes the ping daemon, CGIs and anything the user runs, so `fpc` (forks_per_s x period) is an upper bound on the poller's forks per cycle.
- `tiers`: six samples of `.device.poller_tier` per window. Classify a window as active, idle or deep only when all six agree. Mixed windows are transitions, so skip them.
- `at_ms`: one `qcmd AT` timed from the shell (10 ms resolution). Its normal value is 0 to 20 ms (0 means under 10 ms). A high value means broker queueing or a stuck channel.
- `log_*`: new `/tmp/qmanager.log` lines since the previous window that matched `qcmd_exec failed|modem_timeout`, `modem_busy|lock timeout`, `Modem unreachable`, `watchcat|watchdog`, `QManager Poller starting` (restarts) and `reboot|ssr_hold|baseband|remoteproc`.
- `ssr_new`: new `remoteproc-mss: fatal error` lines in dmesg since the monitor started.

## How to summarise it (for the morning agent)

1. Read both log files (`mon.log.1` first if present) with `mcp__modem__modem_read` or `modem_exec cat`. Read-only: do not restart services or deploy anything.
2. Group windows by tier (all six tier samples equal). For each tier, report the count, median and max of `cpu_pct_core`, `fpc` and `status_period_avg`, and the max `mono_age_max`.
3. Check against the B5.29 targets:

| Metric | Target | Pre-B5.29 baseline (2026-10-18) |
|---|---|---|
| Active `cpu_pct_core` | at most 10 | 36 |
| Idle / deep `cpu_pct_core` | about 2 (floor; idle includes an AT touch every 30 s) | 23 (idle) |
| Forks per cycle (`fpc`, upper bound) | at most 40 | about 450 (poller alone) |
| `status_period_avg` | 2.0 +/- 0.2 in every tier | 3.5 active |
| `mono_age_max` | under 3 s (watchdog allows 30 s) | 4 |
| `ssr_new` | 0, or no higher than the pre-B5.29 rate (0 in about 16 h before the deploy, including 95 min of active tier) | |

4. Flag any window with `log_restart>0` (poller restarted), a change of `poller_pid` or `atd_pid`, `log_busy>0`, `ssr_new` going up, `at_ms` over 100, or `status_period_avg` over 2.2.
5. The user was making changes on the modem during the night, so internet outages, page loads and SMS activity show up as noise. Note them, and don't treat them as regressions unless the poller's numbers move with them.
6. Report the per-tier table, the flags and a pass/fail verdict per target, and leave the summary in the B5.29 notes folder (`side-session-notes/local_8024b36a-716b-469f-b5bc-91284388768d/`).

## Rolling back Phase 1

On the modem (no reboot needed):

```sh
cd /usrdata/qmanager_bak_b529
cp events.sh.orig /usr/lib/qmanager/events.sh
cp ondemand_radio.sh.orig /usr/lib/qmanager/ondemand_radio.sh
cp parse_at.sh.orig /usr/lib/qmanager/parse_at.sh
cp qlog.sh.orig /usr/lib/qmanager/qlog.sh
cp qmanager_poller.orig /usr/bin/qmanager_poller
cp qmanager.orig /etc/init.d/qmanager
cp fetch_data.sh.orig /www/cgi-bin/quecmanager/at_cmd/fetch_data.sh
cp overview.sh.orig /www/cgi-bin/quecmanager/public/overview.sh
md5sum -c md5.orig.txt 2>/dev/null || md5sum *.orig
/etc/init.d/qmanager restart
```

(`md5.orig.txt` lists the backup files by name, so compare those sums with the installed paths by hand.) In git, revert the Phase 1 commit on the B5.29 branch.
