# Cell History

`/cellular/history` is the durable record of what the radio did: which carriers served, which cell, what the PHY negotiated, how much of the carrier this device was given, how balanced the antennas were, when 5G was absent, and when the router restarted. It answers the questions the live surfaces cannot: *"5G disappeared at night, sometimes band 1, on which cell and for how long?"* and *"why is it slow right now compared with yesterday?"*

The page and the row shape were first built in the greenpacket O5A tree. history-v3 (this document) rebuilt the recorder, the archive schema and the read path; the page was rebuilt on top of them. The plan that drove it is `docs/plans/2026-11-27-history-v3.md`; where this document and the plan differ, this document describes the code.

## Quick Reference

| Item | Value |
|---|---|
| Route | `/cellular/history` (`components/cellular/history/history.tsx`) |
| Recorder | `append_cell_history` in `scripts/usr/bin/qmanager_poller` (no daemon of its own) |
| Archive | `/usrdata/qmanager/cell_history/YYYY-MM-DD.jsonl` (UTC day), `.jsonl.gz` once closed |
| Row | schema v2, one positional JSON array per line, one row per UTC minute (v1 keyed rows still read) |
| Storage lib | `scripts/usr/lib/qmanager/history_store.sh` (`hs_maintain`) |
| L1 sampler | `scripts/usr/lib/qmanager/l1_stats.sh` (`l1_sample`), off unless `quecmanager.history.l1_stats=1` |
| Read side | `scripts/usr/lib/qmanager/history_agg.sh` (sourced by the CGI) |
| CGI | `GET /cgi-bin/quecmanager/at_cmd/fetch_signal_history.sh?view=cells&range=<r>[&panels=a,b]` (no-query form unchanged: the 2-minute per-antenna RAM ring) |
| Ranges | `1h 3h 6h 12h 24h 7d 30d` (page default `24h`) |
| Contract | `types/cell-history.ts` (`CellHistorySuccess`), restart shape in `types/ping-history.ts` |
| Hook | `hooks/use-cell-history.ts` (60 s cadence, paused while the tab is hidden) |
| UCI (never seeded) | `quecmanager.history.{l1_stats,cell_keep_days,cell_cap_kb,cell_floor_kb}` |
| Recorder state file | `/tmp/qmanager_cell_history_state` (`state`, `free_kb`, `archive_kb`, `checked`) |
| Read caches | `/tmp/qmanager_hist_cache/` (reduced pieces, 3072 KB cap; response files are not counted and expire after 120 s; purged by `install.sh` and `uninstall.sh`) |
| Restarts source | `/usrdata/qmanager/boot_log.jsonl` (see [connection-quality.md](connection-quality.md#restart-history)) |
| Reboot required | No |

## Where the data comes from

```
qmanager_poller, end of an AT-due cycle whose AT+QENG answered
  l1_sample                      (only when l1_stats=1; one compound AT read per exchange)
  append_cell_history            one row per UTC minute
    -> /usrdata/qmanager/cell_history/YYYY-MM-DD.jsonl
  hs_maintain                    rotation / first row after start / hourly while refused
    expire -> gzip one closed day -> size cap -> free-space floor

GET fetch_signal_history.sh?view=cells&range=<r>
  history_agg.sh                 cached per-piece awk reduction + one merge pass
  -> CellHistorySuccess JSON     (no jq, no per-request regex)
```

- **The recorder lives in the poller.** The serving cell, carriers and per-antenna values are already in memory at the end of an AT cycle. A separate recorder would be a second modem read for data the poller just had. No procd unit, no `install.sh` service.
- **A row is written only when `AT+QENG="servingcell"` answered this cycle** (`_QENG_PARSED`, `_QENG_LINES=1`) and `modem_reachable` is true, and only on the first such cycle of each UTC minute (`_ch_row_due`). A dead modem leaves a gap, never a flat line of stale values. A clock before 2024-01-01 writes nothing (`SANE_EPOCH`), and neither does one that is not yet **trusted** (`clock_trusted`: NTP hotplug marker, `/var/state/dnsmasqsec`, or 30 minutes of uptime; see [connection-quality.md](connection-quality.md#clock_trusted)) because the board has no RTC and the pre-NTP clock passes the 2024 check while being minutes or days off. The L1 sampler is likewise idle while the clock is untrusted **or the archive refuses writes** (`_ch_l1_allowed`), and its accumulators are cleared when the archive becomes writable again, so the first row after a pause never averages in the burst sampled before it. In the deep tier the extra `QCAINFO` + per-antenna read for a row runs at most once per UTC minute (`_ch_deep_extra_due`), even when the row path keeps failing.
- **It is durable.** `/usrdata/qmanager` is the same 32 MB overlay as `/www`, not tmpfs, so the archive survives reboots. The per-antenna `/tmp/qmanager_signal_history.json` is a 2-minute ring and stays as it was.
- **The CGI rides the existing endpoint.** No second CGI, no second auth envelope.
- **The window ends at the wall clock** (`generated_at`), not at the newest row. A recorder that stopped shows an empty tail and `recorder.state` says why. (v1 ended the window at the newest row, which made hours-old data look current.)
- **Aggregation is server-side.** The earlier page derived every shape in TypeScript from raw rows, which capped the range at 24 h. The aggregator now serves the finished shapes for up to 30 days; `derive.ts` keeps only presentation helpers.

## Archive row schema v2

One JSON **array** per line: valid JSON, about half the size of a keyed row, and splittable by awk without a JSON parser. v1 lines start `{"ts"`, v2 lines start `[2,`. An absent reading is `null`, never `0` (a 0 dBm RSRP, a 0 MCS and a 0 PCI are all readings the radio can report).

| # | Field | Unit / values | Source |
|---|---|---|---|
| 1 | `v` | `2` | constant |
| 2 | `ts` | epoch s | poller cycle clock |
| 3 | `rat` | `"LTE"` `"NSA"` `"SA"` `"NOSVC"` | `network_type`; `NOSVC` when QENG answered but no serving cell |
| 4 | `nr_avail` | `1` / `0` / `null` | NR leg reported / modem read and no NR leg / not determined |
| 5 | `tier` | `"a"` `"i"` `"d"` | poller tier at write time (recorded; the aggregator does not read it) |
| 6 | `lte_cell_id` | int | QENG |
| 7 | `lte_tac` | int | QENG |
| 8 | `nr_cell_id` | int | QENG |
| 9 | `nr_tac` | int | QENG |
| 10 | `lte_scc_count` | int | QCAINFO components |
| 11 | `nr_scc_count` | int | QCAINFO components |
| 12 | `total_bw_mhz` | MHz | sum of carrier bandwidths |
| 13 | `lte_cqi` | 1-15 | QENG LTE `<CQI>` (0 = not reported, recorded `null`) |
| 14 | `tx_power` | dBm, one decimal | QENG LTE `<tx_power>` (0.1 dBm raw / 10) |
| 15 | `lte_mcs` | index | L1, burst mean |
| 16 | `lte_ri` | rank | L1, burst max |
| 17 | `lte_ul_mcs` | index | L1, last |
| 18 | `nr_mcs` | index | L1, burst mean |
| 19 | `nr_ri` | rank | L1, burst max |
| 20 | `nr_cqi` | 0-15 | L1, burst mean |
| 21 | `nr_ul_mcs` | index | L1, last |
| 22 | `prb_mean` | PRBs | L1, burst mean |
| 23 | `prb_max` | PRBs | L1, burst max |
| 24 | `prb_n` | count | L1 snapshots behind 22/23 |
| 25 | `n_rb` | PRBs | carrier PRB count from bandwidth x SCS (recorded even with L1 off) |
| 26 | `dl_bps` | bits/s | L1, burst mean of `up/down` |
| 27 | `ul_bps` | bits/s | L1, burst mean |
| 28 | `temp_c` | int | SoC temperature |
| 29 | `cpu_pct` | int | `cpu_usage` |
| 30 | `mem_pct` | int | used / total memory |
| 31-34 | `lte_ant_rsrp[0..3]` | dBm | per-antenna RSRP, `ANTENNA_PORTS` order |
| 35-38 | `nr_ant_rsrp[0..3]` | dBm | per-antenna RSRP |

After column 38, one trailing array per component carrier, **PCC first**:

```
["P"|"S", "L"|"N", band, arfcn, bw_mhz, pci, rsrp, rsrq, sinr, rssi]
```

Example (NSA, one LTE PCC and one NR SCC):

```
[2,1795000000,"NSA",1,"a",48466199,55383,null,null,0,1,60,11,12.0,5,1,19,27,2,15,25,88,133,6,133,177000000,350000,45,30,40,-85,-125,-118,-74,-58,-94,-91,-60,["P","L",1,250,10,104,-75,-10,6,-47],["S","N",41,509070,50,47,-58,-10,30,null]]
```

Rules the writer and every reader rely on:

- **Band is a bare number** in the row (`1`, `41`); the technology is its own column. The display form (`B1`, `n41`) is made at the edge. Never prefix twice (`BB3`).
- **Carriers come from `network.carrier_components[]`** (the `AT+QCAINFO` parse). When QCAINFO gave nothing (a failed read zeroes the components) the writer falls back to the serving cell(s) QENG reported (`_ch_carriers_qeng`), so a row never loses its PCC. LTE 1.4 MHz is carried as `1`.
- **A per-antenna value at or below -140 dBm is recorded `null`.** It is the "not receiving" floor, not a measurement, and it would drag the port's median down. The other RAT's four ports read `null` (an SA row has no LTE ports, an LTE row no NR ports).
- **`NOSVC` rows** carry `null` for columns 6-27 and 31-38 and no carriers (temperature, CPU and memory are still recorded). They exist so "the modem answered and there was no cell" is distinguishable from "nothing was recorded". The aggregator treats such a row as a row with no carriers: no signal series gets a point, `nr_avail` is `null` so it neither opens nor closes an outage, and the identity-event tracker sees `network_type` change to `NOSVC`.
- **`n_rb` is the PRB count of the carrier the PRB reading came from.** `l1_stats.sh` tags the accumulated reading with its RAT (`L1R_PRBSRC`: `nr5g_csi_ext` in NSA and SA gives N, `lte_csi_ext` otherwise gives L) and the row takes `n_rb` from that RAT only: TS 38.101-1 table 5.3.2-1 for 15/30/60 kHz SCS, LTE 15 kHz table (`_ch_nrb`). **Unknown is `null`, never the other RAT's carrier:** an NSA row whose NR bandwidth is unknown has `n_rb` null (the aggregator then emits `prb_share` null) rather than dividing NR PRBs by the LTE PCC's. With no PRB reading (L1 off) the row's own RAT decides.
- **Torn lines are rejected by shape**: a v2 line needs the `[2,` prefix, a closing `]` (and `]]` when it has carriers), `38 + 10k` columns for `k` carriers, and column 2 equal to the timestamp the line starts with; a v1 line needs exactly its 17 keys in order. A write cut by power loss is dropped, never half-parsed.
- **v1 compatibility.** A v1 row is re-laid out as a v2 row with synthetic carriers: an LTE PCC when it has an LTE PCI or band, and an NR carrier when it has an NR PCI or band (an SCC when there is an LTE PCC, else the PCC). Nothing is rewritten; v1 days age out under the normal retention. v1 rows have no carrier count, so they feed neither the `ca` series nor a combo's `ca_cc`.

### Size

The plan estimated about 290 B/row at three carriers and 420 KB/day raw, 50-70 KB/day gzipped. Those numbers were **not measured on the device** before this document was written; the earlier v1 row measured ~253 B (356 KB/day). Check `recorder.archive_kb` and a `ls -ln` of the directory after a few days before quoting a retention figure.

### Schema v3 (2026-11-27): NR TX power

New rows start `[3,` and carry **39 head columns**. They are v2 plus column 39,
`nr_tx_power`: dBm with one decimal, the burst mean of
`AT+QNWCFG="nr5g_tx_pwr"` field 2, taken as PUSCH by analogy with `lte_tx_pwr`.
That field is undocumented, so the PUSCH reading is an inference. A value of
`-32768` means "not available".

- **Requirements:** L1 sampling, and the modem toggle
  `AT+QNWCFG="nr5g_tx_pwr",1` (modem NV, set on the X75).
- **LTE rows:** column 39 is `null`.
- **NOSVC rows:** 9 trailing nulls.
- **LTE TX power:** still column 14, from `AT+QENG` on every row. That value
  alternates between the PUSCH and PUCCH power, so it is noisier than the NR
  column.
- **Reading old rows:** the reducer lifts column 39 out and then treats the row as
  v2, so v2 and v1 rows still read. The series id is `nr_tx_power`.
- **Display:** the PHY "TX power" chart draws LTE (dashed) and NR (solid).

## Storage budget and maintenance

| Setting | Default | UCI override | Meaning |
|---|---|---|---|
| Retention | **30 days** | `quecmanager.history.cell_keep_days` | day files older than this are deleted |
| Directory cap | **3072 KB** | `quecmanager.history.cell_cap_kb` | sum of `ls -ln` sizes of the day files |
| Free-space floor | **4096 KB** | `quecmanager.history.cell_floor_kb` | writes pause when the overlay's free space is under this |

Values that are not whole numbers fall back to the default (0 is also rejected for days and cap). Retention is therefore **the smaller of 30 days and what 3 MB holds**: the cap deletes oldest-first and never today's file. The overrides are never seeded (an absent key is the default) and are re-read at poller start and when the poller reload flag (`/tmp/qmanager_poller_reload`) is consumed; a changed budget applies from the next row (the reload clears the "maintained today" marker), not next midnight.

The floor protects an **install**, not this page: `install.sh` stages a copy of the web tree beside the live one on the same overlay, and a history directory must never be the reason that fails. A missing week of history is recoverable; a failed install is not.

### Maintenance order (`hs_maintain`)

One pass, always in this order:

1. **Expire**: delete day files older than `keep_days`.
2. **Compress**: gzip **one** closed (not today's UTC day) `.jsonl` per pass, under `nice`, through `YYYY-MM-DD.jsonl.gz.tmp`; the `.gz` is test-decompressed before it replaces the original, and on any failure the original stays. Leftover `.gz.tmp` debris is removed first. A day present both ways with a valid `.gz` has its plain copy removed (a previous pass died between the move and the delete).
3. **Cap**: delete oldest day files until the directory fits, never today's.
4. **Floor**: `df -k` on the directory against `floor_kb`. Returns 1 (`state=low_space`) when free space is under the floor, 0 otherwise. An unreadable `df` (0) is not evidence of a full volume and allows the write.

When it runs (`_ch_maintain`): at the first row of each UTC day, at the first row after poller start, after a config reload, and **every hour (`CH_RETRY_SEC`) while the archive is refusing writes or closed days still wait for compression**. There is no per-day latch.

**Why this order exists (the 2026-11-21 deadlock).** The old code checked the floor first, returned before the prune, and remembered the refused day. Free space on the unit fell to 7456 KB, under the 8192 KB floor; nothing could ever delete a file to get back above it, and the latch meant it never asked again. The recorder was dead from 2026-11-21 with a 2084 KB archive that it would have been allowed to trim. Now expiry, compression and the cap run **before** the floor so the pass can free its own space, and a refused archive asks again hourly.

> ℹ️ NOTE: Compression is one day per pass and passes are hourly while any closed `.jsonl` remains, so a backlog of N closed v1 days drains over about N hours, not at once. That is deliberate (a gzip of a large day on a single core, at `nice`).

Recorder state is published as `/tmp/qmanager_cell_history_state` and surfaced as `recorder.state` (below). A write failure appends nothing, logs one warning per day, marks the archive refused and schedules the next pass an hour out.

## L1 sampling

MCS, rank (RI), CQI, uplink MCS, PRB usage and throughput come from `AT+QNWCFG` reads that the poller did not make before. They are **off unless `quecmanager.history.l1_stats` is exactly `1`** (an absent key is off, and it is never seeded). With it off, columns 15-24 and 26-27 record `null` and the PHY and congestion panels say "Reporting off".

```sh
uci set quecmanager.history.l1_stats=1 && uci commit quecmanager
touch /tmp/qmanager_poller_reload        # applied at the next cycle
```

**What is read.** One compound exchange per sample through the poller's own AT path (`_qc_read`), so the QSCAN long-command yield and the per-cycle busy latch apply unchanged:

| RAT | Command |
|---|---|
| LTE | `AT+QNWCFG="lte_csi_ext";+QNWCFG="lte_ulMCS";+QNWCFG="up/down"` |
| NSA | `lte_csi_ext`, `nr5g_csi_ext`, `nr5g_ulMCS`, `lte_ulMCS`, `up/down` (the plan listed no `lte_ulMCS` here; the code reads it because the row carries `lte_ul_mcs` for NSA) |
| SA | `nr5g_csi_ext`, `nr5g_ulMCS`, `up/down` |

Reply formats, measured on an RM551E-GL in NSA:

```
+QNWCFG: "nr5g_csi_ext",1,<mcs>,<ri>,<cqi>,<pmi>,<f6>,<prb>,<f8>
+QNWCFG: "lte_csi_ext",1,<mcs>,<ri>,<cqi>,<pmi>,<f6>,<prb>,<f8>
+QNWCFG: "nr5g_ulMCS",1,<mcs>,<?>      +QNWCFG: "lte_ulMCS",1,<mcs>,<?>
+QNWCFG: "up/down",<ul_bits_s>,<dl_bits_s>,<interval>      (BITS per second on this firmware)
```

A leading `0` on a `*_csi_ext` or `*_ulMCS` line means reporting is off (a modem factory reset): that section records `null`.

> ⚠️ WARNING: these are L1 reads on a background timer, the class of read [adaptive-polling.md](adaptive-polling.md#6-the-data-planel1-group-is-removed-from-the-poller-entirely-rm551e-gl-ssr-fix--final-state) (Invariant 6) removed from the poller because it correlates with MPSS baseband restarts. The sampler is opt-in for that reason and has not been proven SSR-safe; keep it off on units you cannot watch.

**Keys per RAT, and one that is never read.** Each RAT's readings land in its own columns (`lte_*`, `nr_*`). `*_mimo_layers` is **never** read from the poller: it is a firmware hazard when issued in the wrong RAT (`ondemand_radio.sh`), and the rank comes from the RI field of `*_csi_ext` instead. Do not add it back.

**Gates** (all must hold; otherwise nothing is asked):

- an AT-due cycle whose `AT+QENG` answered;
- network type and PCC PCI unchanged since the previous AT cycle (an identity change also **drops the burst collected so far**, so a row never mixes two cells);
- no scan or SIM switch (the cycle never gets here in those cases, and `qcmd` answers `scan_in_progress` otherwise);
- not in a 10-minute back-off after 3 consecutive failed exchanges;
- a busy reply (`modem_busy`, `scan_in_progress`, `invalid_command`) abandons the rest of that minute.

**Pacing**, accumulated as sum/max/n until the row is written, then reset:

| Tier | Under traffic (WAN netdev DL above 1 Mbit/s) | No traffic |
|---|---|---|
| active | one exchange per 6 s | one per row |
| idle | two back-to-back per AT touch | one per row |
| deep | three back-to-back, **only in the cycle a row is due** | same |

Traffic is read from the WAN netdev byte counter (the first readable of `DU_IFACE`, `rmnet_mhi0`, `rmnet_ipa0`, `rmnet_data0`; builtins only, no fork); a rate is only computed over 2 s or more, and a counter that goes backwards reads as no traffic. Estimated cost is about 120-160 ms of channel time per exchange (the plan's figure, not measured here), so about 1.6 s a minute worst case.

**The PRB field is an inference.** Field 7 of `*_csi_ext` is treated as the number of PRBs allocated to this device. Quectel documents no such field; the evidence is that its observed maximum equals the carrier's `N_RB` (133 on a 50 MHz n41 carrier at 30 kHz SCS). The page therefore never presents it as cell load: see Congestion below.

## Reading it back (`history_agg.sh`)

The old CGI spent about 20 s of CPU per 30 s poll on a 7 or 30 day request (24 h: 3.7 s, 113 KB; 7 d: 19.9 s; 30 d: 19.6 s) because it matched a dynamic regex per field per row. BusyBox awk costs about 3 microseconds per operation, so even a positional parse is about 1 ms a row, and a 24 h window is 1440 rows. The only way to be fast is to **never reduce the same row twice**.

1. **Pieces.** The window is cut on hour edges (or 2 h edges when the bucket is larger than an hour) into whole closed days (`D`), whole sealed hours (`H`) and the partial edges (`L`, the window start and "now"). Every bucket width divides the unit, so no bucket straddles two pieces. A unit is sealed 120 s after it ends.
2. **Caches.** A `D` or `H` piece is reduced once by awk into a small tagged TSV in `/tmp/qmanager_hist_cache/` (name carries the day, bucket, unit offset and a reducer version, `HA_CACHE_VER`; bump it when the reducer's output changes). Series come out already rendered as JSON point lists, so the merge pass only concatenates strings and joins the spans (outages, runs, events) that cross piece edges. `L` pieces are reduced live (at most about 120 rows). The **block** cache is capped at 3072 KB (`HA_CACHE_CAP_KB`, `QM_HIST_CACHE_CAP_KB` for tests), evicting oldest first and never a file this request used; `resp_*` files are **not** counted against the cap and every eviction pass deletes the ones older than 120 s (before this a few 100 KB responses ate the cap and a range switch evicted every block). It is tmpfs, so a reboot starts cold, and `install.sh` purges it so an upgrade never serves blocks from an older reducer. Work dirs a SIGKILLed request left behind (`w.<pid>`, builder `wb.<pid>`) are swept on every request: a dead pid or an age over 10 minutes; a builder dir is judged by `bg.lock` instead, because its name carries the spawning CGI's pid, which is gone as soon as it answered.
3. **Locks.** Each block is built under a `mkdir` lock with an atomic `mv`; a lock older than 300 s is taken over, and the request's trap removes its own temp files and locks. **A block is cached only if its source was still the same file after the read:** `hs_maintain` may gzip a closed day between source resolution and the reducer opening it, and a vanished plain file reads as an empty stream, which would be cached for good as "that day had no rows". After reducing, the source is resolved again; if it moved the block is discarded and rebuilt once from the new file, and a day that vanished is not cached at all.
4. **Cold start.** After a boot nothing is cached. A request spends a build budget (12 s, `QM_HIST_BUILD_BUDGET` for tests) on the **newest** missing pieces and answers with what it has; a detached `nice -n 19` builder (one at a time, `bg.lock`) finishes the rest and it shows on a later poll. A partial answer is flagged only by a shorter span: `window.first_ts` reports what was actually covered, and a partial response is never put in the response cache.
5. **Response cache.** `resp_<range>_<panels>.json` is reused while it is under 55 s old **and** not older than the newest day file, so a new row always invalidates it. The page polls every 60 s, so each new row is read once.
6. **Ping join.** `lat`, `jit` and `loss` series are reduced from the ping archive with the same pieces ([connection-quality.md](connection-quality.md#per-minute-ping-archive)).

### Buckets

| Range | Span | Series bucket | Availability bucket |
|---|---|---|---|
| 1h, 3h | 1 h, 3 h | 60 s | 60 s |
| 6h | 6 h | 120 s | 120 s |
| 12h, 24h | 12 h, 24 h | 300 s | 300 s |
| 7d | 7 d | 1800 s | 1800 s |
| 30d | 30 d | 7200 s | 3600 s |

Every average is sum/count over **non-null** readings.

### Measured timings

Reported by the aggregator's builder (method: `tools/history-agg-tests`, see below); not re-measured by the docs pass.

| Case | Cold | Warm |
|---|---|---|
| Real v1 archive, 24h | 3.4 s | 0.43 s |
| Synthetic 30 d v2 archive | 13 s (answered partial; the background builder finishes it) | 1.1 s |

For comparison the old per-poll cost was 3.7 s (24h) and about 20 s (7d, 30d), every poll. The plan's targets were 24h under 1 s and 30d under 3 s warm.

`tools/history-agg-tests/run-tests.sh` builds synthetic archives and checks every response for contract keys and types (null is never 0), torn lines, `.gz` preference, `n=0` ping minutes, restarts, and that the piecewise result equals a single-pass reduction of the same rows. `tools/history-store-tests/run.sh` covers `hs_maintain`, the L1 parser/sampler, row composition and the ping minute.

## Response contract

`types/cell-history.ts` is the authority (`CellHistorySuccess`); this section lists what the code adds beyond the old shape and the rules that are easy to break.

- `window.end` is `generated_at` (the wall clock). `window.samples`, `first_ts`, `last_ts` describe the rows inside it.
- `series` carries one point list per requested panel id (`rsrp sinr rsrq rssi temp cqi rank mcs tx_power total_cells cpu mem dl ul ca bw lte_mcs nr_mcs lte_ri nr_ri lte_cqi nr_cqi ul_mcs lat jit loss`); ids without a reading land in `missing[]`. `?panels=a,b` narrows the key set; unknown ids are ignored.
  - `rsrp sinr rsrq rssi` are the **PCC's** values. The generic `cqi`, `rank`, `mcs` follow the PCC's technology (NR when the PCC is NR or the network is SA, else LTE). `ul_mcs` is the NR uplink MCS in SA, NR when present else LTE in NSA, LTE in LTE.
  - `ca` is the carrier count (PCC included; absent for v1 rows). `bw` is `total_bw_mhz`. `total_cells` is `lte_scc + nr_scc + 1`.
- `carriers[]`: every component carrier seen in the window keyed `L:3:1650` / `N:41:509070`, most samples first, with `role_pct_pcc` (share of its samples as PCC) and `rsrp/rsrq/sinr/rssi` point lists. `cells.band_series` is filled from the same carriers, keyed `B<n>` / `N<n>`.
- `antennas[]`: up to 8 entries (LTE 0-3, NR 0-3) with a bucketed RSRP series and a window `median` (of the per-bucket means, rounded to dBm); ports with no readings are omitted.
- `congestion[]`: per bucket, `prb_share` (sample-weighted mean of `100 x prb_mean / n_rb`), `prb_max_share`, `dl_bps` (bucket mean), `saturated` and `samples`. **`saturated` is true when the bucket's mean `dl_bps` is at least 20 Mbit/s and at least 3 PRB snapshots back it.**
- `recorder`: `{ state, stale_sec, free_kb, archive_kb, oldest_ts, l1_enabled }`. `state` is chosen in this order: `clock_unset` (device clock before 2024), `empty` (no archived row), `ok` (newest row within 180 s), `low_space` (the state file says so), else `stale`.
- `restarts[]`: `boot_log.jsonl` entries whose `boot_ts` is inside the window, oldest first.
- `snapshot`: the newest row's serving cell. A `NOSVC` newest row (the modem answered, nothing serving) gives `cell.network_type: null` and `registered: false` (both the top-level and the `cell` one); the archive token and the `network_type` events from/to it keep the literal `"NOSVC"`, which the page translates. Any other newest row keeps `registered: null` (not determined).
- `device_utc_offset_min`: from `date +%z` (PKT = +300, CST6 = -360). Day files are cut in **UTC** (storage only); every calculation is in epoch seconds and every figure on the page is shown in the viewer's local time.
- `cells` (availability, outages, events, stats, timeline, bands, combos) keep the shapes in the type file; `nr_avail` stays three-valued and a `null` never opens or closes an outage or enters a denominator. Events are capped at 500, newest first.
- Errors use the standard envelope: `invalid_range` for a range outside the list, `internal_error` if the aggregator library is missing, `aggregation_failed` if the merge produced no output.

## The page

Controls: a range pill (`1h 3h 6h 12h 24h 7d 30d`, default `24h`), refresh, a Panels popover. Under them the status banners, the legend, then one line of sample count and span, the "archive is shorter than the range" note, and the "identity logging begins at ..." note.

### Panels

The availability hero is always shown (a page about 5G availability must not be able to hide its answer). The rest are viewer preferences, stored in `localStorage` as `qmanager.cell_history.panels.v2` and merged **onto the defaults** (a panel added later appears at its own default). The key was bumped to v2 deliberately: a v1 object stored `phy: false`, and merging it would have kept the rebuilt PHY panel hidden for everyone who had visited.

| Panel id | Default | Draws |
|---|---|---|
| (hero) | always | 5G availability strip with outage spans |
| `pattern` | on | the nightly pattern: a matrix of days by hour of day, graded by 5G availability (needs a range of a day or more) |
| `timeline` | on | serving-cell gantt and table (PCI, band, 5G share) |
| `carriers` | on | one lane per component carrier (band/tech Tag, share as PCC, when it was present), plus a metric switch RSRP / SINR / RSRQ / RSSI drawing one line per carrier; LTE in the `--lte` family, NR in `--primary`, same-radio carriers separated by dash; a legend entry isolates one carrier |
| `rf` | on | the PCC's RSRP, SINR, RSRQ, RSSI |
| `agg` | on | carrier count and total aggregated bandwidth (step lines) |
| `phy` | on | DL MCS (LTE and NR), UL MCS, rank (RI, step line), CQI (LTE and NR), TX power; the MCS/rank charts say "Reporting off" while L1 sampling is off |
| `congestion` | on | this device's share of the carrier's PRBs over a download-throughput area (see below) |
| `antennas` | on | per-port RSRP lines per radio plus a verdict badge from the shared `lib/antenna-health.ts` |
| `quality` | off | latency and jitter lines and loss bars, from the ping archive |
| `events` | on | cell-change events and per-cell time-on-cell stats |
| `outages` | off | every span 5G was absent, with the serving cell at its start |
| `identity` | off | the newest sample's PCI, bands, channel numbers, TACs |
| `system` | off | temperature, CPU, memory, DL and UL throughput |

The old `bands` panel and the per-band-RSRP card are gone; `carriers` replaces both. Per-carrier signal is now real (every row records every carrier), which is what the earlier "per-band RSRP is only the serving carrier's RSRP" caveat was about.

### Congestion: what the number means

`prb_share` is the share of the carrier's resource blocks **this device** was given. It is **not cell load**. While nobody is downloading, a small share only means this device asked for little. The card therefore draws buckets where `saturated` is true as a solid `--downlink` line and every other bucket as the same line, dashed and faint, with the tooltip saying the link was not saturated. Download throughput sits behind it as an area on its own axis with a floored ceiling (never below 100 Mbit/s). A missing share is a gap, never zero.

### Antennas

The four ports see the same cell, so they should track each other within a few dB. The verdict compares each port's window median with the best port of the same radio: 20 dB or more below is a warning, 30 dB or more is a fault ([antenna-alignment.md](antenna-alignment.md) for the port names). A port that is not reporting is not counted as weak (a 2-RX band legitimately reports two ports), and one reporting port cannot be compared with anything. The dashboard status rail shows the same verdict as a chip; see below.

### Recorder states and banners (`status-banners.tsx`)

| `recorder.state` | Shown |
|---|---|
| `ok` | nothing |
| `stale` | warning: recording stopped N ago; the page shows the last recorded data, with an empty tail |
| `low_space` | warning: recording is paused, storage is low |
| `clock_unset` | warning: waiting for the router's clock |
| `empty` | no banner; the page's empty state says recording begins with the first reading |

A fifth, informational banner appears when `device_utc_offset_min` differs from the browser's offset: times on the page are the browser's time zone, the router's clock is set to another, with a link to System Settings. It changes nothing about the data; it exists so a shift is never silent.

A failed read with figures already on screen keeps them and says they are not updating; a failed first read offers a retry.

### Quality ink (`quality-grade.ts`)

Every graded series is stroked in the quality ramp **by value**. It uses a
vertical hard-stop gradient over the series' own min..max, so the line turns red
exactly where it crosses below "fair" and green where it recovers.

- **Other parts:** graded bars are filled per bar, isolated dots and tooltip
  swatches use the reading's own colour, and a flat line is drawn in one solid
  colour.
- **Identity:** which carrier, port or radio a line belongs to is shown by its
  dash pattern and label. Graded series get a neutral key swatch, and the page
  legend has a Good/Fair/Poor key.
- **App thresholds:** RSRP, RSRQ, SINR and latency use the app's own thresholds
  (`types/modem-status.ts`).
- **Product brackets, not standards:**

  | metric | good / fair cut |
  |---|---|
  | CQI | 10 / 7 |
  | MCS | 20 / 10 |
  | TX power | <= 12 / <= 20 dBm (lower is better) |
  | jitter | 15 / 30 ms |
  | loss | 0.5 / 2 % |
  | temperature | 60 / 75 C |
  | CPU | 70 / 90 % |
  | memory | 80 / 92 % |

- **Not graded:** RSSI, rank, carrier count, bandwidth, throughput and congestion.
  None of them is good or bad on its own.

### Hover sync and restart markers

Every chart carries `syncId="cell-history"` and the same x domain (the payload window), so hovering any instant puts the crosshair and an exact-values tooltip (`ChartTooltipTime`) at that instant in every chart that has data there. The sync matches the **nearest row within a bucket**, not an exact index or timestamp (rows differ by synthetic gap rows), and gives no crosshair when a chart's data stops early. Lines break wherever the silence exceeds `max(3 min, 1.5 x bucket)` (`GAP_THRESHOLD_SECONDS`); a gap is a gap, never a line to zero.

Restarts are dashed vertical marks on every chart, one stroke per cause (dash and hue, so it survives greyscale): `restart` (warning), `power_loss` (destructive), `planned` and `unknown` (neutral, different dashes). The page legend lists a cause only when the window holds one.

### Three states

Loading is a card-shaped skeleton per enabled chart panel (the loaded shell imported, not restated). Empty is the recorder's own statement of why. Error is above. The chart stack loads lazily (`next/dynamic`, `ssr: false`) so cards, headings and empty states render from the payload alone.

## Deep tier and the carrier refresh

In the deep tier the poller normally reads serving-cell only and holds the last carrier values (see [adaptive-polling.md](adaptive-polling.md#7-deep-tier-runs-serving-cell-only-ca-fields-are-intentionally-retained)). For the history row it makes one exception: in a deep cycle where a row is due (at most once a minute), `AT+QCAINFO` and the per-antenna read also run, so the row carries current carriers instead of the last ones seen before the tier went deep. `AT+CFUN?` stays skipped.

## Deploying it

1. The recorder takes effect only after an install: `qmanager_poller` **is** the recorder. The first v2 row appears about a minute after the poller starts.
2. `/usrdata/qmanager/cell_history` is created by `install.sh` (the poller retries at runtime) and removed by `uninstall.sh`, which also removes the `/tmp` caches and state files.
3. Existing v1 day files stay readable and age out; closed ones are gzipped by the maintenance pass (one per hour, see above).
4. Rollback of the L1 reads: `uci set quecmanager.history.l1_stats=0 && uci commit quecmanager && touch /tmp/qmanager_poller_reload`. Reinstalling the previous release works too: its CGI ignores `[2,` lines (its regex needs `"ts":`).
5. The poller's md5 changes, so any operator script that pins it needs re-baselining.
6. After enabling `l1_stats`, watch for modem resets (dmesg MHI `SYS_ERR`/RDDM, `quectel-CM`, the WAN route) for several hours before leaving it on.

## Deliberately not included

- **A live "now" band** (`docs/reference/latency-monitor.md`: shipped once, reverted; a live strip above range cards disagrees with them the moment the range's last bucket ages).
- **Neighbour-cell history**: the page tracks the serving cell and its aggregated carriers only.
- **Per-cell "good cell / bad cell" verdicts**: time-on-cell against availability is a measurement; a verdict is an opinion the device cannot back.
- **CSV export**: no surface asks for it, and a download endpoint is a new auth surface.
- **Backfill**: rows written before the recorder, or before L1 sampling was enabled, do not exist; those panels report "Reporting off" or an empty window rather than zeros.
