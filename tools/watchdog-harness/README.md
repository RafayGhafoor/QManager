# watchdog-harness

Dev-only parity harness for `qmanager_watchcat` and its `wd_*.sh` libraries. Not installed
(`install.sh` never copies `tools/`). It sources the daemon with `WATCHCAT_NO_MAIN=1`, runs
`main` under BusyBox ash in WSL against a fake clock and a scripted scenario tape, and records
everything observable. Two runs of behaviourally identical code give byte-identical output.

## Usage (WSL Ubuntu, BusyBox v1.36.1, jq in `~/bin` or on PATH)

```sh
H="/mnt/d/.../tools/watchdog-harness"
busybox sh "$H/run.sh" list
busybox sh "$H/run.sh" run -o /tmp/wd-split                  # this checkout's daemon + libs
busybox sh "$H/run.sh" run -o /tmp/wd-base -d MONOLITH_FILE  # baseline from the commit-0 monolith
busybox sh "$H/run.sh" run -o /tmp/wd-x 12_user_revert       # one scenario
busybox sh "$H/run.sh" compare /tmp/wd-base /tmp/wd-split    # IDENTICAL / DIFFERS per scenario
```

Monolith for the baseline: `git show 125b3ce6:scripts/usr/bin/qmanager_watchcat > .cache/qmanager_watchcat.mono`
(`125b3ce6` is "allow sourcing the daemon without running main", the last single-file commit).
`baseline/` holds the recorded output of the latest reviewed daemon (Phase 1 commit-0 parity
output until wave 1, see "Phase 2 additions"); `compare baseline <your-out>` is the regression gate.
`WDH_KEEP=1` keeps the per-scenario work dirs (`/dev/shm/wdh.*`) for debugging.

## How isolation works

- The daemon and the libs it sources (`qlog`, `safe_tmp`, `events`, `sim_db`, `conn_state`,
  `wd_*`) are copied into a stage dir with a `sed` rewrite of the absolute device paths
  (`/usr/lib/qmanager/`, `/etc/init.d/`, `/etc/qmanager/`, `/tmp/`, `/var/run/`,
  `/proc/uptime`). The same rewrite is applied to the monolith and to the split files, and the
  repo files are never modified. `/etc/init.d/qmanager_tower_failover` and `profile_mgr.sh`
  become stubs that only log to `calls.log`.
- PATH holds only BusyBox applets and jq (like the device). `qcmd`, `uci`, `date`, `sleep`,
  `dmesg`, `reboot`, `sync`, `logger` are shell functions (`lib.sh`); `qm_trusted_file` is
  stubbed open after the daemon is sourced.
- `sleep` is the clock: the boot settle arms pass 1, each end-of-pass sleep snapshots the state
  and arms the next pass, and the run stops with `exit` after `SC_PASSES` passes so the EXIT
  trap runs. Ping and status caches are regenerated from a small model after every advance.

## Scenario files (`scenarios/NN_name.sh`)

Optional: `SC_PASSES`, `sc_setup` (before `main`), `sc_pass_N` (at the start of pass N),
`sc_qcmd CMD` (print a reply; return 100 to fall back to the default reply table; any other
code becomes qcmd's exit code). Helpers: `mset`/`mget` (model: `reachable`, `link_slot_<n>`,
`slot`, `ping_stale`, `status_stale`, `q_loss`, `q_latency`, `cpin_slot<n>`,
`quimslot_swallow`), `uci_set`, `h_touch`/`h_rm` (files under the fake `/tmp`), `dmesg_crash`,
`failover_write`, `crash_log_add`.

## Output per scenario

`at.log` (every AT command with fake time, pass markers), `calls.log` (uci set/commit, tower
failover init, profile apply, reboot), `passes.txt` (state file, file list and failover record
after every pass), `tree.txt` (every file left in the fake root: events, crash.log, qlog lines,
failover and known-SIM files), `console.log` (stdout/stderr), `exit.code`. PIDs are masked.

## Phase 2 additions (wave 1: daemon core)

New scenario hooks: `sc_post_source` (runs right after the daemon is sourced, before `main`),
`sc_snap_extra PASS` (its output is appended to `passes.txt` under `-- extra` after each pass),
`SC_REAL_SLEEP=1` (keep the daemon's real `wd_sleep`; the scenario drops the fake `sleep` itself,
see `27_*` and `28_*`). Without it `inner.sh` maps `wd_sleep` to the fake clock's `sleep`. New
helper `crash_log_epoch EPOCH REASON` appends a literal-epoch ledger row. `schedule_guard.sh` is
staged with the other libs (the ledger's clock check). Scenarios 24-26 cover the reboot ledger
(count, recent JSON), 27-28 the TERM cleanup (real time, exit code 143, no orphan sleep, state
file gone) and 29 the heartbeat fields with malformed counters.

`baseline/` was re-recorded from the wave-1 daemon. Every difference to the Phase 1 baseline
(still in git history at `760e7d7d`) is one of these:

- the state JSON gains `"mono":N,"stale_after":S` at the end (item 5);
- the final state file is no longer left in `tree.txt`: the EXIT trap removes it (item 3);
- scenarios that start with a failover record (02, 03, 12, 13, 14, 15): the resume `AT+QUIMSLOT?`
  and its log line move from T+0 to T+30, after the boot settle (item 9). 13, 14 and 15 run 3
  passes longer, and 15 moves its lock/unlock hooks by 3 passes, so the whole recheck timeline
  shifts by 30 s and the AT and call sequences stay identical to the old ones;
- scenarios 24-29 exist only in the new baseline.

The per-minute ledger recount (item 1) and the `CFG_ENABLED` default (item 12) change no existing
scenario output; the recount is visible only in 24 and 25.
