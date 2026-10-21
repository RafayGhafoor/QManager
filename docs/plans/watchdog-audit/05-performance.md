# Watchdog modular-lean: device performance run

Date: 2026-10-21. Device: RM551E test modem (4 cores, CLK_TCK 100), slot 1, CFUN 1, ping profile `quiet`, healthy link, no UI viewer.
Branch `worktree-watchdog-modular-lean`, HEAD 3accb6a1. On-device md5: `qmanager_watchcat` 7b0e1e56…, `qmanager_poller` 31bca81a… (both = HEAD).

## Part A: W1 fix (watchdog age outside the AT gate)

**PASS.** Poller 3accb6a1 deployed (scp flat to `/tmp`, `cp .new`, `sync`, `mv`, md5 = HEAD) and restarted. With the new watchdog enabled, `status.json` was sampled every 10 s for 660 s: 66 samples, all `poller_tier=deep`, `wc_state=monitor`, max `age_sec` 13 against `stale_after` 90. The page never showed "Not reporting".

Coverage gap: the poller stayed in `deep` for the whole window, so `idle` was not observed with the daemon running. The read now sits in the always-run block, so it does not depend on the tier.

## Part B: resource use

### Method

`/tmp/wdperf.sh <label> <secs> <pid>` sampled `/proc/stat` (device CPU, `processes` counter), `/proc/<pid>/stat` (utime+stime, plus cutime+cstime for children) for the poller, watchdog and `qmanager_atd`, VmRSS/VmHWM every 10 s, and md5/mtime of `/etc/config/quecmanager` and `/etc/qmanager/*` plus `find -newer` under `/etc` and `/usrdata/rootfs`.

1. **Baseline:** watchdog disabled, 600 s.
2. **New:** modular daemon under procd (`enabled=1`, user tiers: 1-2 on, 3-4 off, quality on, `check_interval` 10), 660 s after a 40 s settle.
3. **Monolith:** init service stopped; the pre-split monolith (`125b3ce6`, md5 ae4076a8…) run directly from `/tmp` under the same UCI, 300 s after a 30 s settle.

The run was split across two sittings. The first sitting lost the host's Ethernet link at about 12:37, after windows 1 and 2 had finished. The modem itself kept running (uptime showed no reboot; `/tmp` samples intact; no new `crash.log` row), so those two windows stand. The user asked for shorter windows on the re-run, so the monolith window is 5 minutes.

The first monolith window caught a 64 s data outage at 14:30 (QCMAP backhaul re-setup and an MCFG reload, likely a baseband SSR). The monolith went SUSPECT and back to MONITOR on its own, with no recovery action. Its device-wide figures (10.3 % CPU, 62 spawns/s) are discarded. A second, clean 5-minute window is used in the table. The daemon's own cost in the outage window was 1.05 % of one core, about the same as when healthy.

### Results

| Metric | Baseline (off) | New modular | Old monolith |
|---|---|---|---|
| Window | 602 s | 663 s | 301 s |
| Device CPU (all 4 cores busy) | 2.76 % | 2.98 % | 3.54 % |
| Watchdog CPU, incl. children (% of one core) | 0 | 0.96 % | 1.06 % |
| Watchdog CPU, self only | 0 | 0.12 % | 0.10 % |
| Watchdog cost per 10 s pass | 0 | ~96 ms | ~106 ms |
| Watchdog RSS / HWM | none | 1920 / 1920 kB (flat) | 1768 / 1768 kB (flat) |
| Process spawns/s (device) | 7.7 | 8.7 (≈ +10 per pass) | 10.4 (≈ +27 per pass) |
| Poller CPU incl. children (% of one core) | 2.92 % | 3.11 % | 3.03 % |
| Poller CPU self | 1.74 % | 1.71 % | 1.68 % |
| `qmanager_atd` CPU | 3 jiffies | 1 jiffy | 1 jiffy |
| AT commands from the watchdog on a healthy pass | n/a | 0 | 0 |
| `qcmd 'AT'` latency (10 calls, ms) | ~10 | 9-20, median 10 | median 10 |
| Writes under `/etc` or rootfs | none | none | none |

Notes:
- Watchdog CPU is almost entirely in children (`jq`, `uci`, `cat`, `date`). The new daemon is about 10 % cheaper per pass and spawns fewer processes than the monolith.
- The device-wide CPU and spawn rate are noisy at this scale. They move with the poller tier (the baseline had 21 of 60 samples in `idle`; the other windows were all `deep`) and with `qmanager_sites` sweeps. Read the per-process rows as the comparison.
- The poller's own CPU is unchanged by the W1 fix (self 1.74 % vs 1.71 %). The small rise including children is the extra watchdog-state read every 10 s plus tier mix.
- RSS is about 150 kB larger for the new daemon (six sourced libraries). It stayed flat for the whole window: no growth.

### Flags

- None over 1 % of one core. The watchdog including children sits at about 1 % of one core, about 0.25 % of the device.
- No per-pass flash writes in any window.
- Observed while restoring: the monolith ignored TERM for more than 12 s and had to be killed with `-9`. This is the "stop never exits" bug the rework fixes (item 3; new daemon stops in 0.1 s per L2).

## Final device state

Watchdog disabled (`quecmanager.watchcat.enabled=0`, init disabled, no daemon running, state and PID files removed; `status.json` reads `enabled:false, state:disabled`). Other `quecmanager.watchcat` and `ping_profile` values unchanged. `/usr/bin/qmanager_watchcat` = HEAD modular version, new poller left deployed, `crash.log` has no new rows, CFUN 1, slot 1, `sync` done. Sampling logs left in `/tmp/wdperf_*` (cleared on reboot).
