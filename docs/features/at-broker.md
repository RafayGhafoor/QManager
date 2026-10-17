# AT Broker (`qmanager_atd`) and Host AT Ports

Every AT command QManager sends reaches the modem through `/usr/bin/qcmd`,
which is a symlink to the persistent Rust AT broker `qmanager_atd`. It is the
only AT path: the original shell gatekeeper and its `atcli_smd11` helper were
removed on 2026-10-16. A separate, unrelated-in-speed toggle turns the vendor
host AT bridge on or off.

**UI:** System Settings: Host AT Ports card (On / Off).
**Source:** `native/qmanager_atd/` (Rust crate). The prebuilt binary is
`dependencies/qmanager_atd`. The build recipe is in `dependencies/README.md`.

## Contents

- [Components](#components)
- [The output contract is frozen](#the-output-contract-is-frozen)
- [How an exchange works](#how-an-exchange-works)
- [Invariants (and why they exist)](#invariants-and-why-they-exist)
- [Host AT ports (`quecmanager.ports.host_at`)](#host-at-ports-quecmanagerportshost_at)
- [Lifecycle](#lifecycle)
- [Validated on the RM551E](#validated-on-the-rm551e-2026-10-16)
- [Rollback](#rollback)

## Components

| Piece | Path | Role |
|---|---|---|
| Rust multicall binary | `/usr/bin/qmanager_atd` | Run as `qmanager_atd` (or `--daemon`): it is the broker. Invoked through the `qcmd` name: it is the client. |
| `qcmd` | `/usr/bin/qcmd` | A **symlink** to `qmanager_atd`, always. `install.sh` creates it and `/etc/init.d/qmanager_atd` re-asserts it at every broker start (`at_qcmd_link`). |
| Broker socket | `/var/run/qmanager_atd.sock` | `0600` root. One request per connection. |
| Link and port library | `/usr/lib/qmanager/at_engine.sh` | `at_qcmd_link` (idempotent atomic repoint of `qcmd`), `at_broker_available`, `at_broker_running`, and the `host_at_*` port-bridge functions. The filename is historical. |
| Boot service | `/etc/init.d/qmanager_atd` | procd, `START=98` (before the poller at 99), `STOP=11`. |
| CGI | `system/host_at_ports.sh` | GET and POST. See `docs/API-REFERENCE.md`. |
| Hook and types | `use-host-at-ports.ts`, `types/at-engine.ts` (host-AT-port types only) | Pessimistic: state is taken from the POST read-back, never flipped locally. |

## The output contract is frozen

The broker reproduces the original shell `qcmd` exactly, because about 50
callers parse its output. The on-device parity suite (18 commands) checks it, and so do the
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
  - The classification matches the original shell `qcmd` exactly (case-sensitive substring).

## How an exchange works

Both the daemon and the in-process fallback run the same `exec::Executor`, so
there is a single behaviour, not two:

1. **Long-flag gate** (short commands only). The *client* checks it before
   it connects, so a short command answers `scan_in_progress` at once instead
   of queueing behind a scan in the single-threaded broker. The executor
   checks it again when the request is served.
   - A short command that was **already queued** when a scan started keeps
     watching the flag while it waits (250 ms slices). Only a long command
     raises the flag and the broker runs one request at a time, so seeing it
     while waiting means "still queued, behind a scan": the client answers
     `scan_in_progress` and drops the socket, and the broker skips the request
     (`peer_gone`), so it never runs. Once reply bytes start arriving the
     client takes the reply instead. Long commands do not watch.
2. **`flock` on `/var/lock/qmanager.lock`.** This uses the same 100 ms grain
   and the same 5 s (short) / 10 s (long) budgets as the original shell `qcmd`. It is also why
   the legacy `sms_tool`, which opens `/dev/smd11` directly under this lock,
   still works beside the broker (no QManager caller uses it any more).
   - The broker serves one request at a time, so waiting in its accept queue
     *is* waiting for the modem. Each request carries its send time
     (`CLOCK_MONOTONIC`), and the queue time is taken off the lock budget: a
     caller never waits longer in total than the original shell `qcmd` did, and a
     request already past its budget answers `modem_busy` without running.
   - A request whose caller has gone (killed by a CGI timeout or a `timeout`
     wrapper while queued, seen as `POLLHUP`) is dropped, not run, like a
     shell `qcmd` killed while waiting for the lock.
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
never leak into the next caller's output, which the original shell `qcmd` could not
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

**A frozen broker is restarted by its clients.** 340 s
(`CLIENT_REPLY_TIMEOUT`) is longer than any exchange can take in the broker
(300 s long deadline + 10 s lock budget + warm-up + worst-case resync, and the
queue budget rejects anything queued behind it at once). So a client that hits
it knows the broker is alive but stuck, which procd never fixes because the
process has not exited. The client logs it, runs
`/etc/init.d/qmanager_atd restart` detached (`setsid`, so a CGI timeout
killing the caller can't abort the restart), and still answers
`command_timeout` without re-running. `/var/run/qmanager_atd.restart`,
created `O_EXCL`, allows one restart per 120 s however many clients time out
together; an older marker is replaced.

**Wire format** (`proto.rs`): `REQ <nbytes> <sent_ms>\n<command>`, reply
`OK <nbytes>\n<raw>` or `ERR <code>\n`. The broker reads the request to EOF
within 2 s and refuses (`command_failed`, logged `refused request`) anything
that times out, exceeds 8 KB, or whose body is not exactly `nbytes`, so a
truncated command never reaches the modem. Client and daemon are one binary
and `install.sh` stops the daemon before replacing it, so the format has no
cross-version compatibility path; an old client against a new daemon is
refused, not executed.

## SMS in the broker (`qsms`)

Since 2026-10-16 the broker also speaks SMS natively, so only the broker
opens `/dev/smd11`. **Every SMS caller uses `qsms`** (phase 3):
`cellular/sms.sh`, `qmanager_sms_forward`, `sms_alerts.sh`,
`sms_forwarding.sh`, `qmanager_sms_storage` (`qsms status ME`, then
`qcmd 'AT+CPMS="ME","ME","ME"'`) and `qmanager_health_check` (`bin.qsms` link
check). `install.sh` links `/usr/bin/qsms` with `at_qsms_link`. `sms_tool` is
still shipped but nothing calls it; phase 4 removes it. Caller contracts are
in [`sms.md`](sms.md), [`sms-forwarding.md`](sms-forwarding.md) and
[`alerts.md`](alerts.md).

- **Callers never take the modem lock around `qsms`.** The broker takes
  `/var/lock/qmanager.lock` itself; a caller already holding it would make the
  broker wait until `modem_busy`. Callers also no longer re-assert
  `AT+CPMS="ME","ME","ME"` (qsms restores it after every op) or filter
  `tcgetattr` noise.
- **Live check after the migration (2026-10-16):** the inbox GET is
  byte-identical before and after (sorted JSON hash, 64 merged messages,
  105/290 used); only `qmanager_atd` held `/dev/smd11` during three GETs; the
  forwarder's seen-set from old and new code is identical (64/64), so nothing
  re-forwards. No live send or delete was run.

- **Client:** `/usr/bin/qsms` → `qmanager_atd` (argv[0] `qsms` is always a
  client, whatever its arguments, since message text may be `-d`). Commands:
  `qsms list [ME|SM|all]` (default ME), `qsms status [ME|SM|all]` (default
  all), `qsms send <number> <text>`, `qsms delete <ME|SM> <idx,...|all>`.
  stdout is one JSON line; rc 0 on success, 1 on failure. Same transport as
  `qcmd`: socket first, in-process only if the request never reached the
  broker, never run twice, frozen-broker restart at 340 s.
- **Wire format:** `SMS <nbytes> <sent_ms>\n` + the arguments joined by NUL
  (argv can't contain NUL, so any text round-trips). Cap 64 KB (AT requests
  keep 8 KB). Reply `RES <0|1> <nbytes>\n<json>` or `ERR <code>\n`. The broker
  re-validates the arguments (`sms::parse_args`).
- **One lock hold per operation** (`exec::Session`): the same long-flag gate,
  5 s lock budget and queue-time accounting as a short AT command, and a 270 s
  session cap (under the client's 340 s reply timeout). Every exchange keeps
  the channel invariants above.
- **CPMS is always restored.** `list`, `status` and `delete` select storage
  with `AT+CPMS="<mem>"` and always finish with `AT+CPMS="ME","ME","ME"`, even
  after a failure (a failed restore adds `"warning":"cpms_restore_failed"`).
- **Send:** `AT+CMGF=0`, then per part `AT+CMGS=<n>`, wait for the `> `
  prompt (bytes, not a line, 10 s), write the hex + Ctrl-Z, read to the final
  code (60 s per part), so the `OK` after `+CMGS:` is consumed. No prompt:
  ESC cancels and the channel is resynced. Stops at the first failed part.
- **Codec** (`pdu.rs`, 23.040/23.038): DELIVER only (stored SUBMITs and
  status reports from `AT+CMGL=4` are skipped and counted); sender never gets
  a `+` (consumers fingerprint on bare digits); timestamp `MM/DD/YY HH:MM:SS`
  sender-local, timezone ignored, exactly as `sms_tool`; GSM7 with the full
  extension table (€), UCS2 with surrogate pairs, 8-bit as hex; concat IE
  00 and 08 (full 16-bit reference). Submit picks GSM7 when every character
  fits (extension = 2 septets), else UCS2; 160/70 single, 153/67 per part,
  never splitting an ESC or surrogate pair, at most 255 parts, TOA 0x91 for
  `+` or ≥6 digits. The legacy encoder's extra-octet, `+` and `?` bugs are not
  reproduced.
- **JSON:** `list` → `{"success":true,"msg":[{"index","storage","stat",
  "sender","timestamp",["reference","part","total",]"encoding","content"}],
  "skipped":N[,"storage_errors":{"SM":"+CMS ERROR: …"}]}` (an unusable SIM
  store doesn't hide ME with `all`). `status` → `{"success":true,"storage",
  "used","total"}` or `{"storages":[…]}`. `send` → `{"success":true,"parts",
  "refs":[…]}`. `delete` → `{"deleted":[…],"failed":[…]}` or, for `all`,
  `{"deleted":N,"remaining":0}` (via `AT+CMGD=<first>,4` with a per-index
  fallback, indexes from `AT+CMGD=?`; covers indexes past 49, which
  `sms_tool delete all` missed). Errors: `{"success":false,"error":<code>,
  "detail"?}` with `modem_busy`, `modem_not_ready`, `scan_in_progress`,
  `command_timeout`, `command_failed`, `send_failed` (detail = `+CMS ERROR: n`),
  `delete_failed`, `bad_number`, `message_too_long`, `bad_args`.
- **Privacy:** SMS replies, numbers and bodies are never logged; the log
  gets one line per operation (`SMS list ME+SM: ok in 222ms`).

**Parity on the RM551E (2026-10-16):** 105 live messages (97 ME, 8 SM):
sender, timestamp, part, total and content equal `sms_tool recv -j` for
105/105; reference differs on 4, all 16-bit references whose low byte is what
`sms_tool` reported. `status` equals `sms_tool status` for ME and SM.
`AT+CPMS?` reads ME,ME,ME after every op. `qsms list all` takes about 0.24 s
against 0.29 s for the two `sms_tool` reads. In-process fallback output is
byte-identical. The 57 `qcmd` parity outputs (9 commands raw and `-j` with rc,
no argument) are byte-identical to the previous broker. Send and delete are
covered by fake-modem tests only (86 crate tests).

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
  scan (`kill`, upgrade restart) leaves `/tmp/qmanager_long_running` behind, and
  every short command would answer `scan_in_progress` until the main service
  restarts. On start the broker removes the flag only if it is at least 15 s
  old **and** the modem lock is free. The in-process fallback client runs the
  same `Executor`, which writes the flag right after it takes the lock, so a
  live holder is normally caught by the lock check alone; the 15 s age floor
  is extra margin against clearing the flag of a caller that has only just
  started a long command.
- **Log lines match `qlog.sh`.**
  - Format: `[YYYY-MM-DD HH:MM:SS] LEVEL [component:pid] msg`, with the same
    256 KB / 2-file rotation.
  - Static musl only honours `$TZ`, so the broker loads OpenWrt's `/etc/TZ`
    itself; without that, its lines would be stamped UTC.
- **`/usr/bin/qcmd` and `/usr/bin/qsms` are never written through.**
  - `at_qcmd_link` / `at_qsms_link` share `_ate_link_to <link> <target>`: a
    temp symlink (`/usr/bin/.qcmd.<pid>`, `.qsms.<pid>`) plus `rename(2)`,
    never `ln -sf`, which would leave a moment with no link at all. Both are
    idempotent, so re-asserting them at every broker start is harmless.
  - `cleanup_legacy_scripts` skips `qmanager_atd` and `qcmd` explicitly; its
    glob never matches `qsms`.

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
1. `install_bundled_binaries` installs `sms_tool` and `qmanager_atd` only, and
   removes any leftover `qcmd.sh` / `atcli_smd11`.
2. `seed_uci_defaults` seeds `ports.host_at` (no `at.engine`). On upgrade it
   deletes the retired `quecmanager.at` section, so a device that had chosen
   Legacy moves to the broker. It then runs `at_qcmd_link` and
   `at_qsms_link`.
3. `start_services` starts `qmanager_atd` before the main service.
4. `stop_services` already stops and kills `qmanager_*`.
5. Firmware detection and the install smoke test run the client through
   `run_atd_qcmd`, a temporary symlink named `qcmd` pointing at
   `qmanager_atd`. Mode comes from argv[0] only: running `qmanager_atd`
   under its own name (with any arguments) starts a **second daemon** that
   takes over the socket, so never invoke it that way for a command. Detection
   keeps the status-cache fallback (an old broker still running during an
   upgrade refuses the new client's request).

`/etc/init.d/qmanager_atd` `start_service` always re-asserts the `qcmd` and
`qsms` links (verified: a removed `qsms` link comes back on restart),
applies the host AT port setting, then starts the broker. It has no engine
check. It has no procd reload trigger on purpose: many CGIs commit
`quecmanager`.

**`uninstall.sh`** restores host AT ports if needed, then removes:
- the `qcmd` and `qsms` links (dangling-safe, via `-L`) and any
  `.qcmd.*` / `.qsms.*` temp links;
- `qmanager_atd`, plus leftover `qcmd.sh` and `atcli_smd11` from old installs;
- the socket and init script.

**`build.sh`** requires and packages `dependencies/qmanager_atd`.
`.gitattributes` marks it `binary` so it never gets CRLF-converted.

## Validated on the RM551E (2026-10-16)

- **Output parity:** 18/18 against the then-shipping legacy `qcmd`, both in-process and through
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
- **Switches:** engine broker → legacy → broker (switch since removed) and
  host-AT off → on round-trip; invalid input is rejected.

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

**Client wait fixes and live QSCAN (2026-10-16):** the queued-short-command
watch and the frozen-broker restart (34 crate tests). Parity 31/31 (daemon and
fallback) and every check above re-ran clean. Then one real `AT+QSCAN=3,1`
through the broker, behind a 3 s lock hold so a short call queued behind it:

- The queued short call answered `scan_in_progress` 2.6 s after it was sent,
  the moment the scan took the lock, and was then skipped by the broker
  (`caller gone before its turn, not run`). Before this fix it would have
  waited for the whole scan.
- Short calls during the scan answered `scan_in_progress` in 10 ms.
- 40 s into the scan the **baseband crashed** (SSR,
  `remoteproc-mss: fatal error … nr_rx_ctl_agc.c:7563 RXCTL_IUSS`, crash #33
  since boot; #32 at 14:46 was the same signature without a scan). The broker
  saw `ENETRESET`, answered `modem_not_ready`, cleared the long flag and
  recovered on the next call without a restart, same pid, no leaked fds: the
  first live SSR against the hardened channel.
- A second `AT+QSCAN=3,1` (15:06) **completed** through the broker in 153 s
  with no SSR (crash counter unchanged at #33): the echo
  (`AT+QSCAN=3,1\r\r\n`), 13 `+QSCAN: "LTE"` rows of 13 fields each, then
  `OK\r` (trailing `\n` stripped per the contract), long flag cleared, the
  next call answered at once. Replayed into `qmanager_cell_scanner`, it parsed
  all 13 cells with no missing band / EARFCN / PCI / signal (bands 1, 3, 8,
  28, 40, 41). No NR5G cell was in range, so the 16-field NR row is untested
  live. One SSR in two scans, matching the crash seen without a scan at 14:46,
  so there is no evidence QSCAN itself causes it.

**Legacy engine removed (2026-10-16):** `qcmd.sh`, `atcli_smd11` and the
engine switch (CGI, Modem Commands card, hook, `quecmanager.at.engine`) were
deleted. The broker is the only AT path.

**Not exercised on the device:** a forced timeout and resync, and the
frozen-broker restart (it needs a broker stuck for 340 s while every AT call
waits). Both are covered by the crate's tests.

## Rollback

There is no runtime switch. To go back to a pre-broker AT path, revert to a
previous release through Software Update or reinstall it.
