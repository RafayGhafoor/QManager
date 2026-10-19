# parse_at.sh quirks a rewrite must preserve

Recorded 2026-10-18 (B5.29 Phase 0) against the pre-B5.29 `parse_at.sh`. Every item is pinned by a fixture in `fixtures/`; `parity.sh` fails on any change. A deliberate change needs sign-off recorded in the ledger row.

## parse_serving_cell
- The reset block does not reset `network_type` or `service_status`. The "no `+QENG:`" path sets only `service_status=unknown`. A state keyword other than NOCONN/LIMSRV/CONNECT/SEARCH leaves `service_status` stale.
- Bare `"servingcell","SEARCH"` with no mode tag falls to the final else (`service_status=unknown`, `network_type` stale). `searching` is reachable only with `"LTE"` on the same line: `lte_state=searching`, `network_type=LTE`, `nr_state=inactive`, early return, all `lte_*` empty.
- Modes are counted by matching lines (`grep -c`): NSA beats SA beats LTE. WCDMA gives unknown/unknown/unknown.
- An LTE line without a `servingcell` line still enters LTE-only: `lte_state=connected`, `lte_band="B"`, other `lte_*` empty.
- `lte_band="B$x"` / `nr_band="N$x"` are always prefixed, even for empty or `-`.
- A trailing CR survives on the last field when it is the one read: NSA LTE line 15 fields (`lte_sinr`), LTE-only 17 fields, SA 16 fields (`nr_scs_raw="1\r"` so `nr_scs=""`). The NSA NR line is CR-safe.
- NSA sets `network_type=5G-NSA` even if the LTE or NR line is missing; that leg's state stays `unknown`. SA sets `nr_state=connected` for NOCONN too. Only the first `servingcell` line is used; in NSA the LTE line is the first `"LTE"` line without `"servingcell"`.
- `cut -d, -fN` returns the whole line when the line has no comma.

## Hex helpers
- `_hex_to_dec` on invalid hex (incl. `-1`, `+5`, trailing CR, `0x` prefix, >= 2^63) echoes `0` with rc 1 (BusyBox printf). Empty gives empty, rc 0. Up to `7FFFFFFFFFFFFFFF` works. `010` is hex 16.
- `_compute_cell_parts` clears `_cid_*` to `""` on the same invalid input (asymmetric with TAC, which becomes `"0"`). `_cid_*` stay set after return. Second arg other than exactly `nr` selects the LTE split (/256, %256); NR is /16384, %16384.

## Per-antenna (QRSRP/QRSRQ/QSINR)
- Only `""` and exactly `-32768` map to null; `-32768\r`, `-32768.0` pass through.
- Line selection is the first unanchored match of `+QRSRP:.*LTE` / `+QRSRP:.*NR5G`; a line with both tags matches both.
- `sed "s/+QRSRP: *//"` strips only that literal prefix; then spaces and CR are deleted. No-comma line gives `[X,X,X,X]`. Fewer than 4 numbers puts the RAT tag in the array; extras are dropped. Values are never validated.
- Empty reply: the poller skips the parsers (`sig_*` unchanged). ERROR text gives all-null arrays.

## parse_carrier / parse_sim_status / parse_sim_slot
- COPS needs at least 2 commas on the whole line (commas inside the quoted name count); name is field 3 with `"` deleted (`"Foo, Inc"` gives `Foo`); no `+COPS:` line gives `""`.
- `*READY*` is tested first, so `NOT READY` gives `ready`. `SIM PIN2` gives `pin_required`. Case-sensitive.
- QUIMSLOT: spaces and CR deleted, unvalidated (`1 2` gives `12`, empty value gives the literal `+QUIMSLOT:`); unchanged when no line.

## parse_ca_info
- CA counts use unanchored greps on the raw reply before the `^+QCAINFO:` filter; `grep -c 'NR'` matches any SCC line containing `NR`. NSA: `t2_nr_ca_count = nr_scc - 1`, active only when `nr_scc > 1`.
- No `^+QCAINFO:` lines: counts kept, total 0, details "", components `"[]"`, no reconcile.
- The poller calls the parser only when `qcmd_exec` rc is 0 and output is non-empty; any `ERROR` text means the reset block instead.
- Prefix strip `s/+QCAINFO: //g`, then `"`, spaces, CR deleted; tabs kept.
- `nfields` is awk NF, so a trailing comma adds a field; NR long form is `nfields >= 9` (a short PCC line with a trailing comma parses as long form).
- Unrecognised band: skipped. Unknown RB/enum: `mhz=0`, component emitted with `bandwidth_mhz:0`, excluded from total/details.
- NR SNR: `-32768` null, else awk `%.1f` of `$1/100` if `$1+0==$1` (BusyBox awk: `0x10` 0.2, `+250` 2.5, `1e4` 100, `.5` 0; `nan`, `inf`, `abc` null; empty prints nothing, then null). LTE SINR is raw except `''`/`-`.
- pci/rsrp/rsrq/rssi sanitiser `*[!0-9-]*` accepts `1-2`, `--5`, `5-`. Freq is unsanitised; empty becomes null.
- Any non-numeric value reaching jq `tonumber` fails the whole jq call: `t2_carrier_components=""` (not `[]`), other globals still set. jq normalises numbers (`007` 7, `1.50` 1.5, `2.0` 2, `0.0` 0, `1e2` 100, huge values `1e+20`).
- Reconcile only when an NR PCC was seen and `network_type` is not 5G-SA/5G-NSA: `network_type=5G-SA`, `nr_state` unknown/inactive becomes connected, `lte_state` unknown becomes inactive.
- The old version used fixed `/tmp/qmanager_c*_*.tmp` scratch files shared with any other caller (a concurrent harness corrupted live poller CA results during Phase 0). The B5.29 version has none.

## parse_temperature
- Averages zones whose type matches `mdmss-*|mdmq6-*|sdr[0-9]*|xo-therm*|sys-therm-*|cpuss-*` with temp > 0; `printf "%.0f"` of `sum/1000/count`, or `""`. sysfs jitter moves it by 1, so the gate compares against old readings taken on both sides.
