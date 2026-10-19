# Data Used counter and Storage meter

Dashboard Device Metrics rows restored by ledger U4.22 (B5.21 Data Used, B5.22 Storage) after U4.10 dropped them for want of a backend. Plan and live recon: `docs/plans/u4-22-device-metrics.md`.

## Files

| Layer | Path |
|---|---|
| Sampler lib (sourced by the poller) | `scripts/usr/lib/qmanager/data_used.sh` (`du_init`, `du_tick`, `du_flush`) |
| Poller call sites | `qmanager_poller`: guarded source after `alert_engine.sh`, `du_init` in `main()`, `du_tick` before `write_cache` (ALWAYS block and the scan / SIM-switch early return), `trap 'du_flush; exit 0' TERM INT` |
| Persistent state | `/usrdata/qmanager/data_used.json` (UBIFS, `qm_durable_write`) |
| RAM mirror | `/var/run/qmanager/data_used.json` (rewritten every sample) |
| Reset flag | `/var/run/qmanager/data_used_reset` |
| CGIs | `network/data_used.sh` (GET), `network/data_used_reset.sh` (POST), `system/storage.sh` (GET) |
| Frontend | `hooks/use-data-used.ts` (10 s), `hooks/use-storage.ts` (30 s), `types/data-used.ts`, `components/dashboard/device-metrics.tsx` |
| Dev test | `tools/data-used-test/data-used-test.sh` (run on the device: `sh data-used-test.sh /path/to/data_used.sh`; 24 cases, fake sysfs in a scratch dir) |

## Source and direction

`rmnet_ipa0` is the aggregate WAN netdev, the parent of `rmnet_data0..N` (one per PDN), on SDX55, SDX65 and the RM551E's SDX7X. It counts more than `rmnet_data0` (all PDNs plus QMAP overhead). The fork's investigation (`git show a05c4e92:docs/reference/data-counter-platform-matrix.md`) found it accurate cumulatively, including IPA fast-path LAN traffic, and found rx = download on both probed SoCs. The sampler reads `/sys/class/net/rmnet_ipa0/statistics/{rx,tx}_bytes` with two builtin `read`s. The AT counters (`QGDCNT`, `QGDNRCNT`) are not used: their semantics differ per firmware.

## Cadence (B5.29 hot-path rules)

| When | Work | Forks |
|---|---|---|
| every cycle (2 s) | `[ -f reset_flag ]` | 0 |
| every 15 cycles (30 s) | sample + RAM mirror | 1 (`mv`) |
| every 10 samples (5 min) while counts moved, on reset, at start, on TERM | `qm_durable_write` to `/usrdata` (two global `sync`s) | about 6 |

`status.json` is not touched, so the printf composer and the parity harness (`tools/poller-parity/`, parsers and composers only) are unaffected.

## Counter rules

| Event | Detection | Action |
|---|---|---|
| normal | `cur >= prev` on both | add the delta |
| netdev re-created (PDN drop, CFUN, mode switch) or wrap | `cur < prev` on either | the counter restarted at 0: add `cur`, `iface_resets += 1` |
| reboot | stored `boot_id` != `/proc/sys/kernel/random/boot_id` | first sample of the boot adds `cur` |
| first start (no file) | load fails, no file | baseline only; bytes from before the install are not counted |
| corrupt or other-schema file | a field fails its numeric guard | start from zero, log once |
| netdev absent or garbage | `read` fails the `case` guard | skip, keep state, `iface_present:false` |
| user reset | flag present | zero, re-baseline (no delta from before the reset), flush at once |

Loss bounds: an unplanned reboot loses at most one flush window (5 min); a planned stop flushes through the TERM trap (ash runs it after the current `sleep`, at most 2 s). Two netdev restarts inside one 30 s window lose the bytes before the second. Shell arithmetic on the device is 64-bit.

`since` and `updated` are wall clock and stored as 0 while the clock is below `DU_SANE_EPOCH` (1700000000, the 1970 boot window); the card then shows no date.

## File schema

`{"schema":1,"rx_bytes":N,"tx_bytes":N,"since":EPOCH|0,"updated":EPOCH|0,"iface":"rmnet_ipa0","iface_present":BOOL,"iface_resets":N,"boot_id":"...","prev_rx":N,"prev_tx":N}`. Written with `printf`, read once at start with one `jq` call. The poller is the only writer of both files.

## CGI contracts

- `GET network/data_used.sh` → `{success:true, available:true, rx_bytes, tx_bytes, since, updated, iface_present, stale}`; `{success:true, available:false}` before the first sample or when the mirror is unreadable. `stale` = the mirror's mtime is older than 90 s (the poller stopped). The card shows absence for `available:false` and `stale:true`.
- `POST network/data_used_reset.sh` → drops the flag and waits up to 5 s (25 x 0.2 s) for the poller to consume it, so success means the counter is already zeroed and persisted. `{success:true}`, or `poller_not_running` (the flag is removed so a later poller start does not reset by surprise) or `reset_failed` (run dir or flag write failed). Both codes are in `errors.json` in the five catalogs.
- `GET system/storage.sh` → `{success:true, storage:{mount:"/usrdata", total_kb, used_kb, available_kb}}` or `storage:null`. One `df -P /usrdata` per request, parsed with `set --`. On the RM551E `/usrdata` is `/dev/ubi2_0` (UBIFS, about 264 MB), which also backs `/`, `/etc`, `/data` and `/persist` through the overlay. (The fork's poller block read a tmpfs by accident on the RM520N; the fork's full `system/modem-subsys.sh` is not ported: CPU and memory are already in `status.json`.)

## Frontend

- Storage: a `MeterRow` with `MetricBar` (warn 80 %, danger 95 %), empty track while unread.
- Data Used: a `PillRow` with down and up totals (direction ink on the glyph only, three significant figures through the card-local `formatTotal` so the label fits at 375 px) and a `restart_alt` ghost button opening an `AlertDialog` (`card-sheen` comes with `AlertDialogContent`). The dialog says "Counting since <date>" when `since` is known. The action keeps the dialog open until the POST answers, then closes and toasts: `metrics.reset_success`, or the backend code through `resolveErrorMessage` with `metrics.reset_error` as the fallback.
- Neither row is gated by `modem_reachable`: both are read on the box, not over AT.

## Lifecycle

Install and update copy the lib and the CGIs with their trees and restart the poller; the state file survives updates. Uninstall removes `/usrdata/qmanager/data_used.json` in `remove_config`, and `/var/run/qmanager` as a whole. Not in config backup (a usage counter is not a setting).
