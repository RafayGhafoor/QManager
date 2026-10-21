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
`baseline/` holds the recorded commit-0 output; `compare baseline <your-out>` is the parity gate.
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
