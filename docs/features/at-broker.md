# AT Broker (`qmanager_atd`), the AT Engine Switch, and Host AT Ports

Every AT command QManager sends reaches the modem through `/usr/bin/qcmd`.
That path is now served by a persistent Rust AT broker by default, with
the original shell gatekeeper kept as a switchable fallback. A
separate, unrelated-in-speed toggle turns the vendor host AT bridge on or off.

**UI:** System Settings: Modem Commands card (Fast / Legacy) and
Host AT Ports card (On / Off).
**Source:** `native/qmanager_atd/` (Rust crate). The prebuilt binary is
`dependencies/qmanager_atd`. The build recipe is in `dependencies/README.md`.

## Contents

- [Components](#components)
- [The output contract is frozen](#the-output-contract-is-frozen)
- [How an exchange works](#how-an-exchange-works)
- [Invariants (and why they exist)](#invariants-and-why-they-exist)
- [Engine switch (`quecmanager.at.engine`)](#engine-switch-quecmanageratengine)
- [Host AT ports (`quecmanager.ports.host_at`)](#host-at-ports-quecmanagerportshost_at)
- [Lifecycle](#lifecycle)
- [Validated on the RM551E](#validated-on-the-rm551e-2026-10-16)
- [Rollback](#rollback)

## Components

| Piece | Path | Role |
|---|---|---|
| Rust multicall binary | `/usr/bin/qmanager_atd` | Run as `qmanager_atd` (or `--daemon`): it is the broker. Invoked through the `qcmd` name: it is the client. |
| `qcmd` | `/usr/bin/qcmd` | A **symlink**, repointed atomically by `at_engine.sh`. It points to `qmanager_atd` (broker, the default) or to `qcmd.sh` (legacy). |
| Legacy gatekeeper | `/usr/bin/qcmd.sh` | The original shell `qcmd`, renamed. Kept for rollback. |
| Broker socket | `/var/run/qmanager_atd.sock` | `0600` root. One request per connection. |
| Engine and port library | `/usr/lib/qmanager/at_engine.sh` | Selects the engine, swaps the link, and reconciles port-bridge state. |
| Boot service | `/etc/init.d/qmanager_atd` | procd, `START=98` (before the poller at 99), `STOP=11`. |
| CGIs | `system/at_engine.sh`, `system/host_at_ports.sh` | Both GET and POST. See `docs/API-REFERENCE.md`. |
| Hooks and types | `use-at-engine.ts`, `use-host-at-ports.ts`, `types/at-engine.ts` | Pessimistic: state is taken from the POST read-back, never flipped locally. |

## The output contract is frozen

The broker reproduces legacy `qcmd` exactly, because about 50 callers parse
its output. The on-device parity suite (18 commands) checks it, and so do the
crate's unit tests:

- **Raw mode:** atcli's bytes with all trailing `\n` stripped, then one `\n`
  added. This mirrors the legacy `result=$(…)` capture followed by `echo`.
  The output keeps the echoed command, the CRLFs and the final `OK`.
  - Callers strip `^AT`, `^OK$` and blank lines themselves (`qmanager_poller` `qcmd_exec`).
- **`-j` mode:** byte-identical to the legacy `jq -n` layout,
  `{success, response, command}` or `{success:false, error, command}`.
- **Exit codes and error strings:**
  - rc 0 means a reply arrived.
  - **AT `ERROR` is rc 0** with `ERROR` in stdout, not a failure.
  - rc 1 with `ERROR: <code>` on stderr (raw mode) means one of: `modem_busy`,
    `modem_not_ready`, `scan_in_progress`, `command_timeout`, `command_failed`.
  - The broker's mapping: lock budget spent (including time queued in the
    broker) is `modem_busy`; the channel lost or reset under a command (EOF,
    `ECONNRESET`, `ENETRESET`, `EBUSY`, `EPIPE`, … — `channel::is_reset`, what an
    SSR produces) or a failed resync is `modem_not_ready`; no terminator before
    the deadline is `command_timeout`; anything else is `command_failed`.
  - A closed stdout never crashes the client: write errors are ignored like
    the shell's `echo`, and the exit code still reports the AT result.
  - No argument: the legacy `no_command` JSON on stderr, rc 1.
- **Long-command behaviour:**
  - Commands classed long (QSCAN, QSCANFREQ, QFOTADL, COPS=0, COPS=2, plus
    `/etc/qmanager/long_commands.list`) set `/tmp/qmanager_long_running` and
    run an `AT` warm-up first.
  - While that flag exists, short commands fast-reject with `scan_in_progress`.
  - The classification matches `qcmd.sh` exactly (case-sensitive substring).

## How an exchange works

Both the daemon and the in-process fallback run the same `exec::Executor`, so
there is a single behaviour, not two:

1. **Long-flag gate** (short commands only). The *client* checks it before
   it connects, so a short command answers `scan_in_progress` at once instead
   of queueing behind a scan in the single-threaded broker. The executor
   checks it again when the request is served.
2. **`flock` on `/var/lock/qmanager.lock`.** This uses the same 100 ms grain
   and the same 5 s (short) / 10 s (long) budgets as `qcmd.sh`. It is also why
   `sms_tool`, which opens `/dev/smd11` directly under this lock, keeps working.
   - The broker serves one request at a time, so waiting in its accept queue
     *is* waiting for the modem. Each request carries its send time
     (`CLOCK_MONOTONIC`), and the queue time is taken off the lock budget: a
     caller never waits longer in total than `qcmd.sh` would have, and a
     request already past its budget answers `modem_busy` without running.
   - A request whose caller has gone (killed by a CGI timeout or a `timeout`
     wrapper while queued, seen as `POLLHUP`) is dropped, not run, like a
     legacy `qcmd` killed while waiting for the lock.
3. **Zero-wait drain** of anything stale in the channel, such as a late reply
   or a URC. Drained bytes are logged, never returned.
4. **Write** the command plus `\r\n`.
5. **Read until a terminator line, with a real deadline.**
   - The terminators are atcli's: `OK`, `ERROR`, `+CME ERROR:`, `+CMS ERROR:`,
     `BUSY`, `NO ANSWER`, `NO CARRIER`, `NO DIALTONE`.
   - Deadlines are 20 s for short commands and 300 s for long ones.
   - A *slow* class (COPS=?, CFUN=, QMBNCFG, CGATT=, QPRTPARA) gets 60 s but
     never sets the long flag.

**After a timeout,** the channel is marked dirty. Before its next use the
broker proves the channel is back in step (`AT` → `OK`), reopens it if
necessary, and otherwise returns `modem_not_ready`. A late reply can therefore
never leak into the next caller's output, which legacy `qcmd` could not
guarantee.

**After an I/O error or EOF** on the channel, the fd is closed and the
channel marked dirty, so the next exchange reopens `/dev/smd11` and proves it
with `AT` → `OK` first. The daemon holds one fd for its whole life; keeping a
fd that errored would make recovery depend on glink healing that fd (on the
RM551E it did after one `ENETRESET`, but nothing guarantees it), and procd
never restarts a daemon that has not exited.

**The client** first tries the socket. It falls back to the same exchange
in-process **only when the request never reached the broker** (no socket,
`ECONNREFUSED`, or a failed write — a short body is refused, see below). Once
the request is delivered, a lost reply (broker died, 340 s reply timeout,
malformed reply) is reported as `command_failed` / `command_timeout`, never
re-run: the broker may already have executed it, and running `COPS=2` or a
`QCFG` write twice is worse than one honest error. AT therefore never depends
on the daemon being up, and a command never runs twice.

**Wire format** (`proto.rs`): `REQ <nbytes> <sent_ms>\n<command>`, reply
`OK <nbytes>\n<raw>` or `ERR <code>\n`. The broker reads the request to EOF
within 2 s and refuses (`command_failed`, logged `refused request`) anything
that times out, exceeds 8 KB, or whose body is not exactly `nbytes`, so a
truncated command never reaches the modem. Client and daemon are one binary
and `install.sh` stops the daemon before replacing it, so the format has no
cross-version compatibility path; an old client against a new daemon is
refused, not executed.

## Invariants (and why they exist)

- **The smd11 fd stays blocking.** Verified on the device: glink_pkt rejects
  `O_NONBLOCK` at `open()` with `EBUSY`, and a *non-blocking write never
  succeeds* (`EBUSY` for the whole deadline), because it is the blocking write
  that asks the remote for an RX intent. Deadlines are enforced elsewhere:
  - Reads go through `poll()` first. This is what bounds the old 300 s
    `glink_pkt_read` stall (see the memory note on the atcli glink hang).
  - Writes and opens each run on a helper thread bounded at 5 s.
- **A wedged write abandons the fd without closing it.** Closing would free
  the fd number while the stuck thread could still finish its write into
  whatever file reused that number. The next exchange opens a fresh fd.
- **A fresh fd is never read before its first write.** glink resets the
  channel (`EBUSY`/`ECONNRESET`) otherwise. atcli always wrote first, and
  `Channel::established` enforces the same order.
- **The broker reads smd11 only inside a locked exchange.** It keeps the fd
  open between exchanges, which is safe because a second opener (`sms_tool`)
  still gets its own reply while this fd is idle (verified on the device).
- **The socket is `0600` root and every peer is `SO_PEERCRED`-checked
  (uid 0).** `/dev/smd11` itself is `crw------- root`, and uhttpd runs CGIs
  as root, so no legitimate caller needs more. The umask is set *before*
  `bind`, so the socket is never briefly world-reachable.
- **State files never follow symlinks.**
  - `/tmp` and `/var/lock` are both `1777` on the device.
  - The long flag, PID file, lock file and log are therefore opened with
    `O_NOFOLLOW`. A planted symlink is unlinked and the file recreated with
    `O_EXCL`.
  - Paths are unchanged, so other scripts keep reading them.
- **A stale long flag is cleared at broker start.** A broker killed during a
  scan (engine switch, `kill`) leaves `/tmp/qmanager_long_running` behind, and
  every short command would answer `scan_in_progress` until the main service
  restarts. On start the broker removes the flag only if it is at least 15 s
  old **and** the modem lock is free: `qcmd.sh` writes the flag *before* it
  waits (up to 10 s) for the lock, so a younger flag may belong to a live
  legacy caller.
- **Log lines match `qlog.sh`.**
  - Format: `[YYYY-MM-DD HH:MM:SS] LEVEL [component:pid] msg`, with the same
    256 KB / 2-file rotation.
  - Static musl only honours `$TZ`, so the broker loads OpenWrt's `/etc/TZ`
    itself; without that, its lines would be stamped UTC.
- **`/usr/bin/qcmd` is never written through.**
  - The engine switch uses a temp symlink plus `rename(2)`, never `ln -sf`,
    which would leave a moment with no `qcmd` at all.
  - The legacy script is `qcmd.sh`, so `install_backend` never copies a file
    named `qcmd` over the link.
  - `cleanup_legacy_scripts` skips `qmanager_atd` and `qcmd` explicitly.

## Engine switch (`quecmanager.at.engine`)

- `broker` is the default; `legacy` is the alternative. `install.sh` seeds
  `broker` and preserves an existing choice on upgrade.
- **Apply** (`system/at_engine.sh` POST):
  1. Save to UCI.
  2. Repoint the link.
  3. Restart the init service. Its `start_service` opens no procd instance for
     legacy, so the daemon stops.
- During a broker→legacy switch, callers move to `qcmd.sh` before the daemon
  stops. Both engines serialise on the same lock in the meantime, so nothing
  races.
- **Boot:** `qmanager_atd` `start_service` re-runs `at_engine_link`, so the
  link always matches UCI.
- The service has no procd reload trigger on purpose: many CGIs commit
  `quecmanager`.

## Host AT ports (`quecmanager.ports.host_at`)

The vendor `/etc/init.d/port-bridged` (START=10) runs two `port-bridge`
instances:
- `at_mdm0 ↔ at_usb0`, the USB AT port;
- `smd7 ↔ at_usb2`, or `smd7 ↔ mhi_pipe_32` when `/dev/mhi_ctrl` exists
  (PCIe mode).

These are the AT ports a USB- or PCIe-attached **host** sees. QManager never
uses them; its path is `/dev/smd11`.

- **Off** (`host_at=0`) runs `port-bridged disable`, then `stop` (procd kills
  both instances and suppresses respawn), then `chmod 600 /dev/smd7`. The
  vendor `start` sets `smd7` to `777`, which leaves a world-writable direct
  path into the AT engine.
- **On** (the default, stock behaviour) runs `enable` and `start`. The vendor
  script restores its own permissions.
- **What it changes:** isolation only. An attached host can no longer issue
  AT commands. **It does not make QManager faster.**
- The UI keeps the consequence visible while Off is selected, with
  PCIe-aware wording.
- **Persistence:** `disable` removes the rc.d links. A firmware update can
  bring them back, so `qmanager_atd` re-applies the setting at boot.
- **Uninstall** restores the bridge (`enable` + `start`) only when QManager
  turned it off, and it does this *before* the `quecmanager` UCI namespace is
  deleted.

## Lifecycle

Every path goes through `install.sh`; the OTA updater runs it too.

**`install.sh`:**
1. `install_bundled_binaries` installs `qmanager_atd`.
2. `seed_uci_defaults` seeds `at.engine` and `ports.host_at`, then runs
   `at_engine_link`.
3. `start_services` starts `qmanager_atd` before the main service.
4. `stop_services` already stops and kills `qmanager_*`.

**`uninstall.sh`** restores host AT ports if needed, then removes:
- the `qcmd` link (dangling-safe, via `-L`);
- `qcmd.sh` and `qmanager_atd`;
- the socket and init script.

**`build.sh`** requires and packages `dependencies/qmanager_atd`.
`.gitattributes` marks it `binary` so it never gets CRLF-converted.

## Validated on the RM551E (2026-10-16)

- **Output parity:** 18/18 against legacy `qcmd`, both in-process and through
  the daemon.
  - Static commands are byte-identical, including `AT+FOOBAR` → `ERROR` rc 0.
  - Live commands are framing-identical.
  - `-j` is byte-identical.
- **Latency:** about **10 ms per call against about 50 ms** for legacy (the
  `/proc/uptime` resolution floor).
- **`sms_tool`** works while the broker holds smd11.
- **Fallback:** works with the daemon down.
- **procd** respawns the broker after `kill -9`.
- **Load:** the poller, watchcat and CGIs ran through the broker with zero
  AT or lock errors.
- **Switches:** engine broker → legacy → broker and host-AT off → on
  round-trip; invalid input is rejected.

**Error-handling hardening (2026-10-16, same day):** a review found six gaps,
all fixed and re-validated on the RM551E:

- Parity re-run 31/31 (12 static commands raw and `-j`, 6 live by shape, no
  argument), both through the daemon and in-process with the daemon stopped.
- Lock held 7 s with two callers queued: both answer `modem_busy` at about
  5 s (the second no longer waits 5 s + 5 s). A caller killed while queued is
  logged `caller gone before its turn, not run`.
- Long flag set: a short command answers `scan_in_progress` in 10 ms. A fresh
  flag survives a broker restart; a 60 s old one is cleared at start.
- A closed stdout pipe: rc 0, no abort. An old-format request is refused.
- Field evidence for the channel fix: at 14:46 the pre-fix broker hit a real
  `ENETRESET` on its long-lived fd and reported `command_failed`. It now
  reports `modem_not_ready` and reopens. The "fd never heals" case is covered
  by the crate's socketpair tests (30 total).

**Not exercised on the device:** a forced timeout and resync, and a real SSR
against the hardened broker. There is no safe way to cause either, so they are
covered by the crate's socketpair tests.

## Rollback

- **One setting:** Modem Commands → Legacy, or
  `uci set quecmanager.at.engine=legacy; uci commit quecmanager; /etc/init.d/qmanager_atd restart`.
- `atcli_smd11` and `qcmd.sh` still ship, so the legacy engine is the exact
  pre-broker path.
