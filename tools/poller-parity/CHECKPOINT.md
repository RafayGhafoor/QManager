# B5.29 rerun checkpoint (2026-10-19, about 06:50 PHT)

Paused on the user's request while redeploying B5.29 and restarting the monitor.

## What happened overnight

- The first monitor (started 2026-10-18 20:11, log in `/tmp/b529_mon`) was lost. The modem's scheduled reboot at 04:00 (`0 4 * * *`) wiped `/tmp` after about 7¾ hours. Then QManager `v0.1.32-draft` was reinstalled at 05:49 and the modem rebooted again, which put the pre-B5.29 files back.
- `/etc/qmanager/crash.log` has no unplanned reboot between 20:11 and 04:00. The CPU, AT and SSR numbers are gone.

## Done this morning

1. **Files redeployed.** Branch `claude/happy-antonelli-6c2e7a` at `cd1ec5dc` was pushed to the modem. All 8 files match `/usrdata/qmanager_bak_b529/md5.b529.txt`. `/etc/init.d/qmanager restart` was run and the new poller came up (pid 28998).
2. **Files staged on the device.** Everything to push is in `/tmp/b529push/` (the 8 files plus `measure.sh`, `overnight_monitor.sh` and `autostart.sh`), and `/tmp/b529push/got` holds their md5s. `/tmp` is lost on a reboot.
3. **Autostart wrapper written.** It is `tools/poller-parity/autostart.sh`. At boot it waits for a sane clock, then waits 120 s, then runs `overnight_monitor.sh` with `MON_DIR=/usrdata/b529_mon` until the wall-clock deadline in `/usrdata/b529_mon/deadline`. It skips if a live monitor is already running.

## Not confirmed

The next command was sent, but the modem stopped answering ping and SSH right after it. That command would have:

- created `/usrdata/b529_mon/bin/` and copied the 3 scripts into it;
- written the deadline (now + 43200 s);
- added this line to `/etc/rc.local`, before `exit 0`:
  `[ -x /usrdata/b529_mon/bin/autostart.sh ] && /usrdata/b529_mon/bin/autostart.sh >/dev/null 2>&1 &   # b529_mon (dev-only B5.29 monitor)`
- started the monitor with `nohup /usrdata/b529_mon/bin/autostart.sh now &`.

It is unknown whether any of it ran. `rc.local` is run by `S95done`, so it does run at boot.

## To resume

1. Wait until the modem answers again. Check uptime and `crash.log` to see whether it rebooted, and why.
2. Check `md5sum /usr/bin/qmanager_poller` against `md5.b529.txt`. The B5.29 files are on the overlay and survive a reboot, but a reinstall overwrites them.
3. Check `/usrdata/b529_mon/` and `/etc/rc.local`. If they are missing, redo the steps above. If `/tmp/b529push` is gone, re-stage the files from the worktree (CRLF stripped) with Posh-SSH `Set-SCPItem`.
4. Confirm that `mon.log` gets its `# start` line, and its first data line about 60 s later.

## Cleanup when the run ends

- Delete the `b529_mon` line from `/etc/rc.local`.
- `rm -rf /usrdata/b529_mon /tmp/b529push`.
- To roll back, follow the steps in `MONITOR.md`.
