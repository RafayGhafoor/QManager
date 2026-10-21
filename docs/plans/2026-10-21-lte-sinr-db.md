# LTE SINR in dB (port of PR #33, backend half)

Credit: RafayGhafoor (dr-dolomite/QManager#33). Re-implemented on `development-home`;
the PR itself is not merged (287 commits stale, Suncomm-specific parts out of scope).

## Claim, validated before porting

`AT+QENG="servingcell"` LTE `<SINR>` is not dB. RG520N/RM5xxN AT manual §5.20:
`Y = (1/5) x X x 10 - 20`, i.e. **Y = 2X - 20 dB**, raw X in 0..25 (-20..+30 dB).
It is the same 1/5-dB encoding the EC25/EP06 manuals document on a 0..250 scale.

Live check, RM551E-GL (`RM551EGL00AAR02A01M8G`), EN-DC, 2026-10-21. There were 20 paired
samples of QENG LTE raw, QCAINFO PCC RSSNR (dB) and AT+QSINR LTE per-antenna (dB):

| QENG raw | n | QCAINFO RSSNR seen | 2X-20 | raw-as-dB |
|---|---|---|---|---|
| 22 | 12 | 24 (x9), 25 (x3) | **24** | 22 |
| 23 | 8 | 26 (x6), 25 (x2) | **26** | 23 |

The conversion matches RSSNR exactly in 15/20 samples and is within 1 dB in the other 5.
Raw-as-dB undershoots by 2-3 dB every time. QSINR per-antenna (22-27) agrees.
Raw goes up 1 step for 2 dB of RSSNR, which is the slope the formula predicts.
This site has high SINR, near the X=20 fixed point, so the error is small here. The PR
author's low-signal unit showed the larger effect: raw 9-12 (printed as 9-12 dB) against
QSINR -4..5 and RSSNR 0..3; converted, that is -2..+4.

### Controlled low-SINR test on our unit (2026-10-21, decisive)

There were about 230 samples at 1 s intervals, in three antenna states. Antennas off pushed the
modem to LTE-only, which exercises the `$_F17` path; with 2/4 antennas it was back on EN-DC,
which exercises the `$_F15` path.

| State | QENG raw X | 2X-20 | QCAINFO RSSNR | QSINR (best port) | raw-as-dB error |
|---|---|---|---|---|---|
| 0/4, B1 FDD, RSRP -119 | 11 | 2 | 2-3 | 3-4 | +8 |
| 0/4, B1 FDD | 12 | 4 | 2-5 (mostly 4) | 4-5 | +8 |
| 0/4, B40 TDD, RSRP -126 | 9-10 | -2..0 | 0-2 | 0-1 | +9..10 |
| 0/4, B40 TDD, CQI 0 | 8 | -4 | 253-255 (invalid) | -1..-3 | +11 |
| 2/4, B1 EN-DC | 22 | 24 | 24-25 | 24-25 | +2 |
| 2/4, B1 EN-DC | 23 | 26 | 25-27 | 26-27 | +3 |
| 2/4, B1 EN-DC | 24 | 28 | 28-29 (some 25) | 28-29 | +4 |

The fit holds from X=8 to X=24 on both FDD and TDD, and on both parser paths. If the raw
value is treated as dB, the reading is 8-11 dB too high at low SINR. **Claim confirmed on our own
RM551E.** The quick test before this one, near X=20, was only consistent with the formula and
couldn't confirm it.

Side finding: QCAINFO RSSNR reads 253-255 whenever QENG reports CQI 0 / tx_power `-`. That
happens in LTE-only TDD, not only in EN-DC, so it is an invalid-reading sentinel. This
addresses the open question in the PR, and `normalizeMetricValue` already nulls it. QSINR
reports -32768 on ports with no antenna.

## Change

**`scripts/usr/lib/qmanager/parse_at.sh`**
- New fork-free helper `_lte_sinr_db_g "<raw>"` that sets `_R`:
  - strips CR (`_S=$1 ; _pat_del "$_PA_CR"`), because `lte_sinr` is the last field on
    the 15-field EN-DC LTE line and the 17-field LTE-only line, so it keeps the CR
  - only accepts 1-2 ASCII digits (`case` patterns), value 0..25, and returns `2X-20`
  - anything else (empty, `-`, `-32768`, negatives, non-numeric, 3+ digits, >25) gives
    `_R=""`, and the status composer then publishes `null` (the `_kN sinr` numeric guard)
  - a leading zero (`05`) is handled as decimal with `${x#0}`, not octal
- `parse_serving_cell()`: `_lte_sinr_db_g "$_F15" ; lte_sinr=$_R` (EN-DC LTE line) and
  `_lte_sinr_db_g "$_F17" ; lte_sinr=$_R` (LTE-only line).
  NR5G-NSA / NR5G-SA `nr_sinr` stay as they are (already dB).
- Untouched: the per-antenna `sig_lte_sinr` (QSINR is dB), the QCAINFO SNR and the
  neighbour-cell SINR (this firmware prints `-` there, so there is nothing to confirm against).

**Behaviour delta worth noting:** today a CR-terminated raw value or `-` passes through
verbatim and is nulled downstream. After the change the parser itself emits `""`. The
`status.json` result (`null`) is the same for those inputs.

## Parity gate (`tools/poller-parity/`)

The gate proves *byte-identical* globals, but this change is intentionally not identical,
so:
1. `sinr_expect.sh` (new): a table-driven test of `_lte_sinr_db_g` that sources
   `parse_at.sh` and covers 0, 10, 20, 22, 25, 26, 05, `-`, `-32768`, empty, `<CR>`,
   `22<CR>`, ` 22`, `2a`, `100` and `-5`, each with its expected `_R`.
2. Fixtures: add `serving_cell__lte_sinr_scaled.txt` and `serving_cell__nsa_lte_sinr_scaled.txt`
   (raw 11 gives 2, with NR SINR 32 untouched, which is the proof that the NR path is
   left alone), plus the edge rows in `gen_fixtures.sh` so the corpus regenerates byte
   for byte.
3. `parity.sh old new`: the only allowed diffs are `lte_sinr=` lines in `serving_cell__*`.
   I'll add `PARITY_ALLOW_SINR=1`, which accepts a diff only when new == `2*old-20` (old
   = CR-stripped raw 0..25) or new is empty and old was non-convertible. Every other diff
   still fails the gate.
4. Then `parity.sh new new` (sanity) and `--tap` against a live tap ring.

Documentation for the new mode goes into `tools/poller-parity/README.md`.

## Not in scope (decide)

- **Rust parser port** (`native/qmanager_atd/src/parse*`, unwired, `#[allow(dead_code)]`).
  Its host parity corpus (`tests/parity/expected.*`) is a frozen snapshot of the old shell
  output. My proposal is to leave it alone and record the drift in
  `docs/features/adaptive-polling.md` ("port the conversion before Phase D wiring"), not
  regenerate a binary corpus for code nothing calls.
- Frontend: nothing to do. `normalizeMetricValue` in `lib/radio-info.ts` is already on
  `development-home`.

## Validation

1. `.claude/check-crlf.sh` on every touched shell file, and the BusyBox/POSIX audit
   (no `$(...)` in the helper, `local` one per line, no bashisms).
2. The parity steps above, run under the device's BusyBox ash in `/tmp/pp`.
3. Deploy `parse_at.sh` (scp flat to `/tmp`, then `mv`, `sync`, md5 check) and restart the
   poller. Confirm `jq .lte.sinr /tmp/qmanager_status.json` is within about 1-2 dB of the
   QCAINFO RSSNR and the QSINR max over several cycles.

## Docs and close

- `docs/API-REFERENCE.md`: `lte.sinr` is dB, converted from QENG `2X-20`, and `null` when
  not reported.
- `RELEASE_NOTE.md` Improvements: one bullet crediting RafayGhafoor.
- One atomic commit on `claude/magical-lamport-8197a5` (based on `development-home` 4ed6201d).
  Afterwards I'll ask whether to merge, keep or discard.
