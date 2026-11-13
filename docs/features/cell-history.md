# Cell History

`/cellular/history` — the serving-cell, band and 5G-availability record. It answers
the one question the live surfaces cannot: *"5G disappeared at night, sometimes band
1 — on which cell, and for how long?"*

Ported from the greenpacket O5A tree (`docs/specs/cell-history.md` there), where the
archive and the page were built first. The idea and the row shape came across; the
file tree did not. This doc records the three places this tree differs, because each
is a decision a future change must not undo by accident.

## Where the data comes from

```
qmanager_poller, once the AT block of a cycle has answered
  └── append_cell_history
        └── /usrdata/qmanager/cell_history/YYYY-MM-DD.jsonl   (NDJSON, one row a minute)

GET /cgi-bin/quecmanager/at_cmd/fetch_signal_history.sh?view=cells&range=<r>
  └── the rows inside the window, as a JSON array

components/cellular/history/derive.ts
  └── availability buckets, outage spans, serving runs, per-cell stats, changes
```

- **The recorder lives in the poller, not in a daemon of its own.** The serving-cell
  values are already in memory at the end of an AT cycle, so a separate recorder would
  be a second modem read for data the poller just had. No new procd unit, no new
  `install.sh` service, no extra AT traffic.
- **It is durable, and that is the point of the feature.** `/usrdata/qmanager` is the
  same 32 MB overlay as `/www` (measured: 15.1 MB free) — not tmpfs — so history
  survives a reboot. The existing per-antenna `/tmp/qmanager_signal_history.json` is a
  2-minute RAM ring and cannot answer anything about last night; it stays as it is.
- **The CGI view rides the existing endpoint.** `fetch_signal_history.sh` already
  served the dashboard's 2-minute ring; `?view=cells` adds the durable read. The no-query
  form is unchanged, byte for byte. No second CGI, no second auth envelope.
- **The derivation is in TypeScript, not in awk.** The reference needed one awk pass
  because it served 43k-row days; here the ceiling is a **24 h** range, i.e. ≤1440 rows,
  so the browsing derives the shapes from typed, unit-tested code
  (`derive.test.ts`). That is also why the range list stops at 24 h: a week would be
  ~10k rows of JSON through a single-core CGI, and that is where the derivation would
  have to move back into the backend.

## Budget: why 2 MB and 14 days

| Figure | Value | How |
|---|---|---|
| Row size | **~253 B** | measured: mean length of rows `append_cell_history` composed |
| Rows per day | 1440 | one a minute while the AT read answers |
| Per day | **~356 KB** | derived: 253 B x 1440 |
| Directory cap | **2048 KB** (`CELL_HISTORY_CAP_KB`) | ~5-6 days on disk, so the cap binds before retention |
| Retention | **14 days** (`CELL_HISTORY_KEEP_DAYS`) | whole files, oldest first |
| Free-space floor | **8192 KB** (`CELL_HISTORY_MIN_FREE_KB`) | a day file is not started below it |

The floor protects an **install**, not this page: `install.sh` stages a ~12.6 MB copy of
the web tree beside the live one, and on a 15 MB-free overlay a history directory must
never be the reason that fails. A missing week of history is recoverable; a failed
install is not.

Both the floor check and the prune run **when a new day file would be started**, never
per row: `df` and the size pass are forks, and neither can change overnight by more than
one day's rows. A refused day is remembered, so the floor costs one `df` a day. The size
cap deletes the **oldest** day file first and never the one being written.

## The row

```jsonc
{"ts":1794578209,"rat":"5G-NSA","lte_pci":123,"lte_band":"B3","lte_earfcn":1650,
 "lte_bw":20,"lte_cell_id":12345,"lte_tac":4321,"nr_pci":201,"nr_band":"N78",
 "nr_arfcn":632448,"nr_cell_id":null,"nr_tac":null,"nr_avail":1,
 "rsrp":-70,"rsrq":-11.5,"sinr":12.5}
```

- **An absent reading is `null`, never `0`.** A 0 dBm RSRP and a 0 PCI are real
  readings, so a missing value written as 0 would be indistinguishable from a measured
  one. `_jnumv`/`_kSN` do the mapping.
- **`nr_avail` is three-valued**: `1` an NR cell was reported, `0` the modem answered
  and reported no NR leg, `null` nothing determined (`nr_state` `unknown`). A null never
  opens or closes an outage and never enters an availability denominator. "We did not
  look" and "5G is gone" are opposite claims and only one is a fault.
- **Bands are display-ready** ("B3", "N78") because `parse_serving_cell` prefixes them.
  Nothing downstream may prefix again — `"B" + band` renders `BB3`.
- **A row is only written on a cycle whose `AT+QENG="servingcell"` read answered**
  (`_QENG_PARSED`), so an unreachable modem leaves a gap rather than a flat line of the
  last values it held.
- **A torn final line never reaches the page**: the CGI filters on the whole row shape
  (`CELL_ROW_RE`), not a prefix, so a write interrupted by power loss is dropped instead
  of breaking the JSON.

## The page

One range pill (`1h 3h 6h 12h 24h`, default `24h`), a Panels picker, the page legend,
then the availability hero and eight panels. Every panel is derived from the same row
shape in `derive.ts`; **no panel has a field the recorder does not write.**

| Panel | Derived from | Answers |
|---|---|---|
| 5G availability (hero, always shown) | `availabilityBuckets`, `nrOutages` | was 5G up, and when was it not |
| Nightly pattern | `patternRows` (`ts` + `nr_avail`) | does the dropout repeat at the same hour |
| Serving cell (gantt + table) | `servingRuns`, `timelineSegments`, `cellStats` | which cell and band served, for how long, with what 5G share |
| Radio readings | `metricSeries` (`rsrp`, `rsrq`, `sinr`) | how the reading moved either side of a dropout |
| Bands and 5G leg | `bandRuns` (`lte_band` + `nr_band`), `bandCombos` | which band set served, and when the 5G leg left it |
| Signal by band | `bandRsrpSeries` (`lte_band` + `rsrp`) | which band was the weaker one |
| Cell changes | `cellEvents` | which identity field moved, from what to what |
| 5G outages (opt-in) | `outageRows` (`nrOutages` + the serving runs) | every span 5G was absent, with the cell serving at its start |
| Serving cell identity (opt-in) | `newestSample` | the newest sample's PCI, bands, channel numbers and TACs |

Panel visibility is a **browser preference** (`panels.ts`, `localStorage`,
`qmanager.cell_history.panels.v1`), merged onto the defaults — a panel added later appears
at its own default rather than vanishing for a returning reader. The hero is not in the
list: a page about 5G availability must not be able to hide its own answer. The defaults
open the six panels the field complaint needs and leave the outage table and the identity
grid one click away.

### What is derived, and what is NOT recorded

The row is 17 fields and the panels above use all of them. Nothing is invented to fill a
panel out:

- **Per-band RSRP is not per-carrier RSRP.** A row records ONE `rsrp` — the serving
  carrier's. The Signal-by-band card therefore plots "the RSRP while on that band", which
  is the honest reading the record can back; it is not per-component-carrier signal (that
  would need `AT+QCAINFO` at every sample, i.e. extra modem traffic).
- **There is no carrier-aggregation panel.** `lte_bw` is the serving carrier's downlink
  bandwidth; the row has no aggregated-carrier count and no total bandwidth, so a "CA
  carriers" or "total MHz" column would be a figure the record cannot support.
- **`nr_band` going null IS the 5G-leg event.** The band-set strip cuts a run where
  `lte_band + nr_band` changes, so a leg that left and returned is a visible boundary
  without a second recorder field.
- **`nr_cell_id` and `nr_tac` are null on this modem while `nr_avail` is 1.** The identity
  grid prints them as a dash, and never backfills them from the LTE cell ID/TAC: a
  true-looking number for a field the modem did not send is worse than a gap.
- **The RF group has three charts, not eight.** RSSI, CQI, rank, MCS, TX power, temperature,
  CPU, memory and throughput are not in a cell-history row, so there is no chart of a line
  at zero for them. Adding them would mean the poller writing values it already holds —
  a deliberate non-goal of this port, because the archive's 2 MB / 14-day budget is sized
  for ~253 B rows and every added column spends it.
- **The nightly pattern is two rows, at most.** A day is this endpoint's ceiling, so a 24 h
  window covers two local days. The night hours still line up in the same columns on both
  rows, which is what the panel is read for; the matrix is honest about being two rows.
- **The chart stack is loaded lazily** (`next/dynamic`, `ssr: false`) so the card shells,
  headings and empty states render from the payload alone. Same construction, and the same
  stack (Next 16.0.7 / React 19.2.1 / recharts 2.15.4 / `output: "export"`), as the
  reference build.

- **The window ends at the newest archived row**, not the wall clock, so an archive that
  stopped updating shows its last span instead of an empty chart.
- **The page says when it could not see.** Lines under the controls report how many
  readings came back, the span they cover, when the span is materially shorter than the
  range asked for, and when identity coverage starts part-way through. A history surface
  must never print "5G never dropped" about hours it could not observe.
- **An empty record is a state, not a blank page.** With no rows the page states that
  recording begins with the first reading after this build runs — a strip with nothing on
  it reads as "no 5G", the exact inversion of the truth.
- **Colour is never the only channel.** Each availability tier also owns a bar height and
  a legend entry; a serving run's bottom rule is backed by the percentage in its tooltip
  and by the table's numeric `5G` column; a band set's tone is backed by the combo string
  printed inside the segment and by the table's swatch; a band's quality ramp is backed by
  the median in dBm and its quality word in the legend; identity (PCI, band) is neutral ink
  plus a `Tag`, never a large tinted block.
- **Gaps are gaps.** Every run and outage span is cut at `GAP_THRESHOLD_SECONDS` (3 min),
  because the writer is not a metronome: no row lands during a scan, an unreachable modem
  or a poller restart.

`docs/reference/latency-monitor.md` records why there is **no live band** here: a live
strip above range cards disagrees with them the moment the range's last row is a minute
old. The dashboard is the live surface; this page reads a range.

## Deploying it

1. The recorder takes effect **only after an install** — `qmanager_poller` is the
   recorder, so nothing appears on the page until the new poller is running. The first
   day file appears one minute after the poller starts.
2. `/usrdata/qmanager/cell_history` is created by `install.sh` and, if that fails, retried
   at runtime by the poller. It is removed by `uninstall.sh`.
3. Expect the first hours to be sparse: the range pill's window is the archive's, so a
   device installed an hour ago shows exactly one hour of data and says so.
4. The poller's md5 changes, so any operator script that pins it needs re-baselining.

## Deliberately not included

- **A longer range** (7 d / 30 d): the CGI serves raw rows; see above.
- **Per-component-carrier history, CA counts and the deeper PHY/device panels** the
  reference build plots (RSSI, CQI, rank, MCS, TX power, temperature, CPU, memory,
  throughput): those columns are not in the row, and adding them is a poller-and-budget
  change, not a UI one.
- **A live/now band**, per `docs/reference/latency-monitor.md`.
- **Neighbour-cell history**: this page tracks the **serving** cell only.
- **Per-cell "good cell / bad cell" verdicts**: time-on-cell against availability is a
  measurement; a verdict is an opinion the device cannot back.
- **CSV export**: no surface asks for it, and a download endpoint is a new auth surface.
- **Backfill**: rows written before the recorder existed do not exist.
