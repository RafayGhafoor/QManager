# SMS

The SMS feature exposes a read/send/delete inbox over the modem's AT channel (`/dev/smd11`). Every shell caller talks to the modem through `qsms`, the SMS client of the Rust AT broker (`qmanager_atd`). The broker is the only process that opens `/dev/smd11` and it takes `/var/lock/qmanager.lock` itself for the whole operation, so SMS calls never race against `qcmd`. The old bundled `sms_tool` binary is no longer called by anything (see [Legacy: `sms_tool`](#legacy-sms_tool)).

> ℹ️ NOTE: SMS **downtime alerts** (connection-lost/restored notifications sent over SMS) are documented separately in [`docs/features/alerts.md`](alerts.md) — they're one channel in the centralized Alerts feature, which also covers email and the shared routing/capability model. This doc covers the inbox (read/send/delete) and the `qsms` transport only. `sms_alerts.sh` still exists as the SMS channel's transport lib (config I/O, `qsms send`, retry, logging) but no longer owns downtime *detection* — that lives in `alert_engine.sh`.

## Quick Reference

| Item | Value |
|---|---|
| Inbox CGI | `GET/POST /cgi-bin/quecmanager/cellular/sms.sh` |
| AT channel | `/dev/smd11` (opened only by `qmanager_atd`) |
| Transport | `/usr/bin/qsms`, a symlink to `/usr/bin/qmanager_atd` (argv[0] `qsms` selects the SMS client); socket `/var/run/qmanager_atd.sock` |
| Lock | `/var/lock/qmanager.lock`, taken by the broker itself. Callers never wrap `qsms` in `flock` |
| Legacy binary | `/usr/bin/sms_tool` (still installed, unused; removed from the bundle in phase 4) |
| Storage boot daemon | `/usr/bin/qmanager_sms_storage` (init.d: `/etc/init.d/qmanager_sms_storage`, START=99) |
| Reboot | Never |

## `qsms` Transport

`/usr/bin/qsms` is a second symlink to `/usr/bin/qmanager_atd` (like `/usr/bin/qcmd`). argv[0] `qsms` selects the SMS client. Same transport as `qcmd`: the unix socket `/var/run/qmanager_atd.sock` first, with an in-process fallback only if the request never reached the broker. See [`at-broker.md`](at-broker.md). stdout is exactly one JSON line; exit 0 on success, 1 on failure.

| Command | Success shape | Failure shape |
|---|---|---|
| `qsms list [ME\|SM\|all]` (default `ME`) | `{"success":true,"msg":[{"index":N,"storage":"ME","stat":N,"sender":"...","timestamp":"MM/DD/YY HH:MM:SS","encoding":"gsm7","content":"..."}]}`. Multipart messages add `reference`, `part`, `total`. | `{"success":false,"error":"<code>"[,"detail":"..."]}` |
| `qsms status [ME\|SM\|all]` (default `all`) | `all`: `{"success":true,"storages":[{"storage":"ME","used":2,"total":255},{"storage":"SM",...}]}`. Single storage: `{"success":true,"storage":"SM","used":1,"total":255}` | generic failure |
| `qsms send <number> <text>` | `{"success":true,"parts":N,"refs":[...]}` | `{"success":false,"error":"send_failed","detail":"+CMS ERROR: 500","parts":3,"sent_parts":1,"refs":[41]}` |
| `qsms delete <ME\|SM> <idx,idx,...>` | `{"success":true,"storage":"SM","deleted":[1],"failed":[]}` | `success:false` with `"failed":[{"index":9,"error":"+CMS ERROR: 321"}]` |
| `qsms delete <ME\|SM> all` | `{"success":true,"storage":"ME","deleted":62,"remaining":0}` | generic failure |

Generic failure codes include `modem_busy` and `scan_in_progress` (the broker's transport codes), `send_failed`, `delete_failed` and usage errors. Details:

- With `list all`, an unusable SIM store does not fail the call. The response adds `"storage_errors":{"SM":"+CMS ERROR: 310"}` and the ME messages are still returned.
- A per-message decode failure shows up as `"error":"error decoding pdu"` inside that message object, not as a call failure.
- `delete <store> all` clears every index the store reports, not just 0..49.
- Message bodies and phone numbers never reach the broker log.

### Broker-Owned Lock

The broker takes `/var/lock/qmanager.lock` itself for the whole `qsms` operation, the same lock `qcmd` uses.

> ⚠️ WARNING: Callers must never wrap `qsms` in `flock` on `/var/lock/qmanager.lock`. The broker would wait on the caller's own lock until it gives up with `modem_busy`.

**Why:** The previous design had each shell caller hold the lock around `sms_tool` with a 10 s polling wait (BusyBox `flock` has no `-w`) and exit 99 on timeout. That duplicated the broker's job and could deadlock against it. Lock contention now surfaces as the `modem_busy` / `scan_in_progress` error codes from `qsms`, and each caller maps them (the inbox CGI to the `modem_busy` envelope; the alert transport to rc 2, see below).

Callers also no longer filter `tcgetattr`/`tcsetattr` noise from stderr: there is no termios code path in the broker, and stdout carries only the JSON line.

## SMS Storage Routing (`AT+CPMS`)

`AT+CPMS` controls three independent storage pointers: mem1 (read/delete source), mem2 (send destination), and mem3 (incoming-message routing). On the RM551E the modem defaults mem3 to `SM` (SIM card), so every incoming SMS is written to the SIM rather than modem memory (`ME`). QManager read `ME` exclusively, which meant incoming messages accumulated silently on the SIM card and never appeared in the inbox.

**The fix** is two-pronged: a boot daemon that asserts `AT+CPMS="ME","ME","ME"` at startup, and `qsms` itself, which restores that routing after every operation that selects a storage.

### `AT+CPMS` mem1/mem2/mem3 model

| Pointer | Controls | QManager target |
|---|---|---|
| mem1 | Storage read/delete operations | `ME` (255 slots) |
| mem2 | Storage used for sent messages | `ME` |
| mem3 | Storage for incoming SMS routing | `ME` |

**Why `ME` and not `SM`:** The SIM card typically has 35 slots. `ME` provides 255 slots and is modem-resident, so it survives SIM swaps. If mem3 stays `SM` and the SIM fills up, the modem silently discards further incoming messages.

### Boot daemon (`qmanager_sms_storage`)

`/usr/bin/qmanager_sms_storage` runs once at boot (init.d START=99). It polls `qsms status ME` until it succeeds (20 tries, 3 s apart), then sets `AT+CPMS="ME","ME","ME"` through `qcmd`. It counts the set as done only if `qcmd` exits 0 **and** an `OK` line is present in the output, because `qcmd` exits 0 even on `AT ERROR`. There is no `flock` in the script. The daemon does not respawn and does not trigger a reboot or `AT+CFUN`.

The matching init.d script (`/etc/init.d/qmanager_sms_storage`) uses `#!/bin/sh /etc/rc.common`, is a non-procd one-shot, and double-forks the daemon so init.d's `start` call returns immediately. It is auto-enabled by the directory-driven `install.sh` discovery — it is NOT in `UCI_GATED_SERVICES`, so `enable_services()` enables it unconditionally. No installer change is needed when this file is added.

### Restore after every operation

Selecting `SM` flips modem mem1 to `SM` as a side effect. `qsms` restores `AT+CPMS="ME","ME","ME"` after every operation that selects a storage (list, status, delete), even when the operation fails. Callers do not re-assert it, and there is no GET-time step sequence to maintain.

**Why it matters:** other readers (the forwarding daemon, the health check's `AT+CPMS?`) assume mem1 is `ME`. If a failed `SM` operation left it on `SM`, they would read the SIM until the next successful operation or reboot.

### Dual-storage merge

`qsms list all` returns every message already tagged `"storage": "ME"` or `"SM"`. Multi-part reassembly in the CGI groups by `sender + reference + storage` — not just `sender + reference` — so a message whose parts straddle both memories is never incorrectly merged. The merge also drops `stat`.

`storage.used` and `storage.total` in the GET response are the **sum** of ME and SM usage (from `qsms status all`), not ME-only. This gives an honest picture when some messages still reside on the SIM. If the combined call fails, the CGI falls back to `qsms status ME`.

### Storage-aware delete

The `delete` POST takes a `storage` field (`"ME"` or `"SM"`, default `"ME"` if absent, validated). The CGI makes one `qsms delete <STORAGE> i,j,k` call for all indexes. Indexes that are not plain non-negative integers are not sent and count as failures. The failed count comes from the length of `.failed` in the response (all indexes if the call itself failed at transport level); a busy modem returns the `modem_busy` envelope.

`delete_all` clears both memories in sequence (`qsms delete ME all`, then `qsms delete SM all`). A failure returns `delete_all_failed` with the per-storage reasons joined as `ME: ... | SM: ...`.

## Read/Unread State (Client-Side)

The modem cannot be the source of truth for per-message read/unread status for two reasons: (1) `qsms list` emits a numeric `stat` but the CGI's multi-part merge drops it, so no read flag reaches the browser; (2) every inbox GET issues `AT+CMGL=4` (what `qsms list` uses) which the modem treats as "mark all read", so any modem-side unread flag self-erases on every fetch. Read state is therefore tracked entirely in the browser.

**Hook:** `hooks/use-sms-read-state.ts` — exports `useSmsReadState`, `smsFingerprint`, and `parseSmsTimestamp`.

**Persistence:** `localStorage` under the key `qmanager.sms.read.v1` as a JSON array of fingerprint strings. Reads on mount, writes on every state change (errors are swallowed — quota exceeded or storage disabled; read-state is best-effort).

### Message Fingerprinting

There is no stable backend message ID. The fingerprint is a djb2 hash of the string `storage|sender|timestamp|content`. It is base-36 encoded (unsigned 32-bit). The hash covers `storage` so that two messages with identical sender/timestamp/content but different storage locations (ME vs. SM) produce different fingerprints and can be marked independently.

### Self-Pruning

On every write (`markRead` and `markAllRead`), the stored set is intersected with the fingerprints of the **currently-present** message list before the new entry is added. This ensures that when messages are deleted on the modem, their read-markers are evicted from `localStorage` on the next state change — the set cannot grow unbounded.

**Why:** Without pruning, every deleted message leaves a dead fingerprint in `localStorage` indefinitely. The prune step is implicit in `markRead` and explicit in `markAllRead`.

### Known Trade-offs

- Read state is **per-browser**. It does not sync across devices. Clearing browser storage resets all read markers.
- New incoming messages appear as unread by default (fingerprint absent from the stored set).
- Opening the View dialog marks the message read immediately (`markRead` is called in the `openMessage` callback inside `sms-inbox-card.tsx`).

### Inbox Tabs and UI

`components/cellular/sms/sms-inbox-card.tsx` adds three shadcn `Tabs`: **All**, **Unread {count}**, and **Read**. Unread rows carry a primary-color dot indicator and `font-semibold` styling. A "Mark all read" action in the card's `CardAction` area calls `markAllRead` and fires a toast.

---

## Timestamp Sorting

> ⚠️ WARNING: `qsms` emits timestamps in `"MM/DD/YY HH:MM:SS"` format (zero-padded, fixed-width, ASCII). Plain lexicographic sort (`sort_by(.timestamp)`) mis-orders messages across month/year boundaries — for example, `"12/31/25 23:59:59"` sorts alphabetically **after** `"01/01/26 00:00:00"` because `"12"` > `"01"`. Never sort directly on the raw timestamp field.

The backend (`sms.sh` GET handler, `messages=$(... jq ...)` block) applies a slice-reordering key before reversing:

```sh
sort_by(.timestamp[6:8] + .timestamp[0:2] + .timestamp[3:5] + .timestamp[8:]) | reverse
```

This rearranges the fixed-width slices into `"YYMMDD HH:MM:SS"` — a sortable string that orders correctly across month and year boundaries.

The frontend (`parseSmsTimestamp` in `hooks/use-sms-read-state.ts`) parses the same `MM/DD/YY HH:MM:SS` format into epoch millis and sorts descending client-side, so newest-first ordering is robust regardless of backend ordering.

**Why both layers:** The backend sort is authoritative. The client-side sort is a safety net for any future scenario where backend ordering is disrupted (e.g., storage merge returning unsorted results).

---

## Deferred Features

### Cross-Page Toast Notification (deferred)

Goal: show a toast when a new SMS arrives while the user is on a different page. The only AT-channel-safe path is piggybacking on `qmanager_poller` — a full `sms.sh` GET holds the broker's `/var/lock/qmanager.lock` for the duration of its `qsms` calls (~0.26 s with the old `sms_tool` path), making it too heavyweight to run app-wide on every poll cycle. The intended design: `qmanager_poller` writes an unread/new-count field into `/tmp/qmanager_status.json`; an `AppLayout` hook consumes that field; the existing global `<Toaster/>` fires the notification. Latency would be bounded by the poller's SMS-check cadence (not instant). This is a known, intended follow-up — the plumbing is not yet in place.

> ℹ️ NOTE: SMS Forwarding (automatic relay of incoming messages to another number) is a separate daemon — see [`docs/features/sms-forwarding.md`](sms-forwarding.md). `qmanager_sms_forward` is the **only** server-side inbox reader in the project; all other read-state is client-side.

---

## Inbox CGI (`cellular/sms.sh`)

**GET** — one `qsms list all` (each message already tagged with its storage), then the merge, then `qsms status all` for the storage counts (falls back to `qsms status ME` if the combined call fails). `.storage_errors` from the list (for example an unusable SIM) is logged as a warning and does not hide the ME messages. Multi-part messages are grouped by `sender + reference + storage`, and the timestamp slice-reorder sort below is unchanged. `indexes` in each message lists every storage slot for that message so a single `delete` call clears them all.

GET failure envelopes: a list failure with code `modem_busy` or `scan_in_progress` returns `{"success":false,"error":"modem_busy","detail":"Could not acquire AT lock"}`; any other list failure returns `{"success":false,"error":"<code or command_failed>","detail":"..."}`.

Response message object shape:

```json
{
  "sender": "+1234567890",
  "message": "Hello",
  "indexes": [3],
  "storage": "ME"
}
```

`storage` is `"ME"` or `"SM"`. The `storage.used`/`storage.total` envelope fields reflect the sum of both memories.

**POST actions:**

| Action | Required fields | Notes |
|---|---|---|
| `send` | `phone`, `message` | Strips a leading `+` from `phone` before calling `qsms send`; no other normalization |
| `delete` | `indexes` (array), `storage` (`"ME"`\|`"SM"`, default `"ME"`) | Validates each index as a plain non-negative integer (others count as failures), then one `qsms delete <STORAGE> i,j,k` call; returns `partial_failure` if any slot fails; busy returns `modem_busy` |
| `delete_all` | — | `qsms delete ME all` then `qsms delete SM all`; error `delete_all_failed` with `ME: ... \| SM: ...` details |

On `send` failure the envelope is `{ "success": false, "error": "send_failed", "detail": "<qsms detail>" }` (HTTP 200 with the error in the JSON body, not a 4xx status). A busy modem (`modem_busy` / `scan_in_progress` from `qsms`) returns the `modem_busy` envelope instead.

## SMS Channel Transport (`sms_alerts.sh`)

Sourced by `qmanager_poller`. Downtime *detection* (the outage timer, threshold debounce, recovery-guard suppression) lives in `alert_engine.sh` — see [`docs/features/alerts.md`](alerts.md). This lib owns the SMS channel's transport: config I/O, the actual `qsms send` with retry (`_sa_do_send`: 3 attempts, 5 s apart, registration check on each), and log writing. There is no lock in this lib; the broker serializes. The engine calls in via `sms_alert_emit <event> <secs>`, which returns:

- `0`: sent.
- `1`: failed, terminal.
- `2`: not ready, retry next cycle. This is either "modem not registered" or, since phase 3, "every attempt that reached `qsms` failed with `modem_busy` / `scan_in_progress`". **Why:** a busy modem is transient, so the alert engine must retry next cycle instead of burning the one send per outage. Attempts that were all skipped for registration with no `qsms` error stay terminal as before.

**Guards:**

- `_sa_is_registered()` short-circuits on `conn_internet_available=true` so the recovery branch is never blocked by stale `lte_state`/`nr_state`.

**Failure logging:** `qlog_error` receives full context — `modem_reachable`, `lte_state`, `nr_state`, `conn`, and `last_err` formatted `<code>[: <detail>]` from the `qsms` response. No breadcrumb file.

## Phone Number Handling

- Inbox CGI (`send` action): strips a leading `+` exactly once; everything else passes verbatim to `qsms send`. Users must supply the full international number.
- Alerts CGI (`monitoring/alerts.sh`): strips a leading `+` exactly once before writing to `sms_alerts.json`. Storage and GET responses always return raw digits (no leading `+`). The send path passes the stored value verbatim to `qsms send`.

## Legacy: `sms_tool`

Phase 3 moved every caller from the bundled `/usr/bin/sms_tool` to `qsms`. The binary is still shipped by `install.sh` and removed by `uninstall.sh`, but nothing calls it. Phase 4 (separate, later) stops bundling it. Until then, this is what it is.

`sms_tool` is a patched fork of [`obsy/sms_tool`](https://github.com/obsy/sms_tool) (Apache-2.0), statically linked for ARM EABI5. The patches and the rebuild recipe are in [`dependencies/README.md`](../../dependencies/README.md):

1. Default device `/dev/smd11` instead of `/dev/ttyUSB0` (bare `recv` used to segfault on the RM551E).
2. `isatty()` guards in `setserial()` and `resetserial()`, because `/dev/smd11` is a Qualcomm SMD char device and termios calls return `ENOTTY`.
3. `exit(1)` on open/reopen/fdopen failures instead of a `setvbuf(NULL,…)` SIGSEGV; `open()` traces gated behind `-D`.

The history behind the move: callers wrapped it in a shell `flock` with a 10 s polling wait (exit 99 on timeout), captured stderr to a temp file to keep termios noise out of the JSON stream, used `-s ME|SM` (which flipped mem1 and forced `AT+CPMS` re-assertion before and after reads), and parsed the word-format `status` line (`Storage type: ME, used: 0, total: 255`). None of that remains in live code. An earlier direction (PR #22) tried a native shell+awk PDU codec (`sms_pdu.awk`); it was abandoned in favour of `sms_tool` and later superseded by the Rust `qsms` client.

## On-Device Smoke Test

```sh
qsms status                          # both storages: {"success":true,"storages":[...]}
qsms status ME                       # single storage: used/total
qsms list all | jq '.msg | length'   # message count across ME + SM
cat /dev/null | qsms list SM         # SIM store only; stdin closed so nothing blocks
ls -l /usr/bin/qsms                  # -> qmanager_atd
```
