# U4.22 Device Metrics restore (B5.21 Data Used, B5.22 Storage)

Lane plan for ledger rows U4.22, B5.21, B5.22. Size: **Large** (poller, install lockstep). Wave plan: `docs/plans/polish-wave.md`.

## Live recon (RM551E, 2026-10-19 ~23:00, read-only)

- SoC `SDX7X` (`RM551EGL00AAR02A01M8G_01.001`), `aarch64`. BusyBox ash arithmetic is 64-bit (`$((9223372036854775807))` works), so byte totals do not overflow.
- Netdevs: `rmnet_ipa0` (aggregate WAN parent) and `rmnet_data0` (the one PDN, default route); `rmnet_data1..5,15,16` idle. `rmnet_ipa0` reads above `rmnet_data0` (all PDNs plus QMAP overhead), the same layout as SDX55/SDX65 in the fork's `docs/reference/data-counter-platform-matrix.md`. The fork's finding holds: count `rmnet_ipa0`. `/sys/class/net/rmnet_ipa0/statistics/{rx,tx}_bytes` exist, so a sample is two builtin `read`s, no `grep`/`awk`.
- Direction: not tested live (internet was down during recon, so a known download could not be run). The fork measured "normal" orientation (rx = download) on SDX55 and SDX65. I will run a ~5 MB on-modem download once the link is up and confirm before shipping; if it reads reversed, swap the two reads (one line).
- `/usrdata` is `/dev/ubi2_0`, UBIFS, 270 504 KB, 174 384 used, 96 120 free (64%). It also backs `/`, `/etc`, `/data`, `/persist` (overlay upper dir), so it is the one writable volume a user fills. The fork's Storage row read a tmpfs by accident on the RM520N; here `df -P /usrdata` reads the real volume.
- `/usrdata/qmanager/` exists (apn files, `sites/`, `sms_sent.json`); no `data_used.json`.
- The modem's uptime was 1:13 at 22:58, and `crash.log` shows a `user` reboot about 21:45, which falls inside the B5.29 soak window. Whether the soak result stands is for the B5.29 owner; I deploy no poller change until the B5.29 row records a result (see Risks).

## Design

### Data Used: a low-cadence sampler hosted by the poller, off the hot path

A new lib `scripts/usr/lib/qmanager/data_used.sh`, sourced by the poller (guarded `[ -f ] && .`). The poller gains three call sites only: `du_init` in `main()`, `du_tick` in the ALWAYS block of `poll_cycle` (and the scan early-return branch), and a `TERM`/`INT` trap that calls `du_flush` and exits.

- **Every cycle:** one `[ -f "$DU_RESET_FLAG" ]` test (builtin, no fork). Nothing else.
- **Every 15 cycles (30 s):** read `rx_bytes`/`tx_bytes` with `read` builtins, delta against the previous sample, add to the accumulators, write the RAM mirror `/var/run/qmanager/data_used.json` (`printf > tmp`, `mv`: one fork per 30 s).
- **Every 150 cycles (5 min), on reset, and on poller stop:** persist to `/usrdata/qmanager/data_used.json` (same printf + `mv`). About 290 small UBIFS writes a day, against the fork's write every 2 s.
- **status.json is not touched**, so the printf composer, its `jq empty` net and `tools/poller-parity/` are unaffected. The CGI reads the RAM mirror.

Counter rules (improving on the fork, which dropped every byte after an interface reset):

| Event | Detection | Action |
|---|---|---|
| Normal sample | `cur >= prev` | add `cur - prev` |
| Interface re-created (PDN drop, CFUN, mode switch) or a wrap | `cur < prev` on either direction | the counter restarted at 0, so add `cur` (bytes since restart), count `iface_resets` |
| Reboot | stored `boot_id` differs from `/proc/sys/kernel/random/boot_id` | same as above: add `cur`, then rebase. Loss is bounded by the 5 min flush window for an unplanned reboot; a planned reboot flushes through the TERM trap |
| Netdev absent | read fails | skip the sample, keep state, set `iface_present:false` in the mirror so the card can say so instead of freezing silently (the fork's C5 failure) |
| Non-numeric read | `case` guard | skip the sample |
| Corrupt or missing state file | load fails the numeric guards | start from zero, log once |

File schema (`data_used.json`, also the mirror): `{schema:1, rx_bytes, tx_bytes, since (epoch of last reset), updated (epoch), iface:"rmnet_ipa0", iface_present, iface_resets, boot_id, prev_rx, prev_tx}`. `rx` = download, `tx` = upload. Times use wall clock only for display; a 1970 clock writes `since:0` and the card shows no "since" date (the clock-step class in `docs/features/scheduled-jobs.md`).

Reset: `network/data_used_reset.sh` (POST) touches `/var/run/qmanager/data_used_reset` (via `safe_tmp.sh` `qm_run_dir`), then waits up to 4 s (0.2 s steps) for the poller to consume it. The poller zeroes the accumulators, keeps the kernel baseline, and flushes at once. The CGI returns `{success:true}` when the flag is gone, else `{success:false, error:"poller_not_running"}` (new code in `errors.json`, all five catalogs). The poller is the only writer of both files.

### Storage: CGI only, no poller change

`system/storage.sh` (GET): `df -P /usrdata`, parsed with `set --` (no awk), returns `{mount:"/usrdata", total_kb, used_kb, available_kb}` or `{storage:null}` when `df` fails. Storage changes slowly; the hook polls every 30 s. I do not port the fork's `system/modem-subsys.sh` wholesale: its CPU and memory are already in this target's `status.json`, and its subsystem crash fields belong to a System Settings card that is not in this row. Ledger B5.22 is closed with that deviation noted.

### Frontend

- `types/data-used.ts`, `types/storage.ts`.
- `hooks/use-data-used.ts` (port of the fork's; 10 s poll, in-flight guard, `reset()` returns `{success, error}` so the toast reads the returned reason through `resolveErrorMessage`, never stale hook state).
- `hooks/use-storage.ts` (30 s poll).
- `components/dashboard/device-metrics.tsx`: restore the fork's Storage row (`MetricBar` + used / total, empty track when unread) and the Data Used row (down + up totals in the `--downlink` / `--uplink` direction tokens, total figure neutral, `TickingValue`), with the reset `AlertDialog` (`AlertDialogContent` carries `card-sheen`), Material glyphs only (route is `/dashboard`), `toast.success` / `toast.error` at the handler, skeleton rows from the existing shape constants. "Since <date>" as quiet secondary text. Built through the Impeccable skill against `DESIGN.md` and the fork's card (`git show a05c4e92:components/dashboard/device-metrics.tsx`).
- i18n: the fork's `metrics.storage_label`, `data_used_label`, `reset_*` keys plus `since`, `counter_unavailable`, the new error code; all five catalogs.

## Build order and team

1. **Backend (Opus, me):** `data_used.sh` lib, poller hooks, the two Data Used CGIs, `storage.sh`, `errors.json` code. Poller and lib changes are sensitive (cadence, trap), so no delegation.
2. **Host test:** a small BusyBox-sh test under `scripts/test/` that drives `du_tick` against a fake sysfs dir (normal, reset, boot_id change, missing netdev, garbage, reset flag), run in WSL busybox `sh`.
3. **Lifecycle (Opus):** install copies libs and CGIs by tree already; add `mkdir -p /usrdata/qmanager` (exists) and nothing else on install. Update = install path, the state file is kept across updates. Uninstall: remove `/usrdata/qmanager/data_used.json` and the `/var/run/qmanager/data_used*` files. Config backup: not included (a usage counter is not a setting).
4. **Hooks + card (Sonnet 5.5 high builder, or me via Impeccable craft):** types, hooks, card, i18n in five catalogs.
5. **Validate** (below), then docs.

## Validation

- Static: `.claude/check-crlf.sh`, `sh -n`, bashism / multi-var `local` / `jq` regex audit on every touched shell file; poller parity gate `tools/poller-parity/` still zero-diff.
- On device, **CGIs and lib first** (no poller restart needed for `storage.sh`): deploy, `sync`, `modem_cgi system/storage.sh`.
- On device, **poller**: only after the B5.29 row records a result. Deploy, `sync`, restart the poller, then check: mirror updates every 30 s; a 5 MB download moves `rx_bytes` by about 5 MB (direction check); reset through `modem_cgi` zeroes within 4 s and persists; `kill -TERM` of the poller flushes; poller CPU and period unchanged versus the B5.29 figures (active about 4.9%, period 2.00 s). No reboot test (rule); the boot_id path is covered by the host test.
- Frontend: `bunx tsc --noEmit`, eslint on touched files, `bun run i18n:check`, `bun run icons:check`, `bun run build`; browser preview of the card at 375 and 1440, light and dark, loading / empty / error states, and the reset dialog.

## Risks

- **B5.29 soak.** The modem rebooted inside the soak window. I will not restart the poller with my change until the B5.29 row says the soak is finished (or you tell me it is abandoned). Until then everything except the poller can still be built, host-tested and deployed.
- **Direction unverified on SDX7X** until the internet is up (see recon).
- **Lost bytes:** an unplanned reboot loses up to 5 min of counting; an interface reset between two samples loses nothing now (it adds `cur`), unless the interface reset twice inside 30 s.
- **Trap in the poller:** a `TERM` trap must not change procd stop behaviour; it flushes and exits 0 within one sleep (at most 2 s).
- **Carrier mismatch:** the counter measures what the modem's netdev sees, which is close to but not the carrier's billing count. The card says "Data used", not "billed".

## Rollback

Each layer is independent: removing the three poller call sites (or the lib file, since the source is guarded) stops sampling and the CGI reports the counter as unavailable; the card hides the Data Used row's figures behind its empty state. Storage is a standalone CGI. Revert is one commit per layer on this branch.

## Docs

New `docs/features/data-used.md` (counter rules, files, cadence, reset handshake, direction finding); `docs/features/adaptive-polling.md` (the sampler's cadence and that it is off the hot path); routing rows in `CLAUDE.md` and `docs/features/README.md`; `RELEASE_NOTE.md` (Data Used and Storage back on the dashboard); ledger rows U4.22, B5.21, B5.22 only.
