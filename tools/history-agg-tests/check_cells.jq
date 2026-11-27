# check_cells.jq - shape validation of a CellHistorySuccess (types/cell-history.ts).
# Prints one string per violation; an empty array means the response is well formed.
# `null` is a value, `0` is a reading: nothing here accepts one for the other.
def isnum: type == "number";
def numnull: . == null or isnum;
def strnull: . == null or type == "string";
def pts: type == "array" and all(.[]; type == "object" and (.ts | isnum) and (.v | isnum));
def ascending: ([.[].ts]) as $t | ($t == ($t | sort)) and (($t | unique | length) == ($t | length));
def keys_are($ks): (keys | sort) == ($ks | sort);
def panels: ["rsrp","sinr","rsrq","rssi","temp","cqi","rank","mcs","tx_power","total_cells","cpu","mem","dl","ul","ca","bw","lte_mcs","nr_mcs","lte_ri","nr_ri","lte_cqi","nr_cqi","ul_mcs","nr_tx_power","lat","jit","loss"];
def chk(c; m): if c then empty else m end;

[
  chk(keys_are(["success","view","range","generated_at","bucket_sec","window","coverage","snapshot","series","missing","cells","recorder","device_utc_offset_min","carriers","antennas","congestion","restarts"]); "top-level keys"),
  chk(.success == true; "success"),
  chk(.view == "cells"; "view"),
  chk(.range | IN("1h","3h","6h","12h","24h","7d","30d"); "range"),
  chk(.generated_at | isnum; "generated_at"),
  chk(.bucket_sec | isnum; "bucket_sec"),
  chk((.window | keys_are(["start","end","samples","first_ts","last_ts"])) and (.window.start | isnum) and (.window.end | isnum)
      and (.window.samples | isnum) and (.window.first_ts | numnull) and (.window.last_ts | numnull); "window"),
  chk(.window.end == .generated_at; "window.end must be the wall clock (generated_at)"),
  chk((.coverage | keys_are(["cell_from"])) and (.coverage.cell_from | numnull); "coverage"),
  chk((.snapshot | keys_are(["carrier","registered","cell","as_of"])) and (.snapshot.as_of | numnull)
      and (.snapshot.cell | keys_are(["lte_pci","lte_earfcn","lte_band","lte_bw","lte_cellid","lte_tac","nr_pci","nr_arfcn","nr_band","nr_bw","nr_cellid","nr_tac","network_type","registered","nr_avail"])); "snapshot"),
  chk(.snapshot.cell.nr_avail | IN(0, 1, null); "snapshot.cell.nr_avail"),
  chk((.series | keys_are(panels)); "series keys"),
  chk(all(.series[]; pts and ascending); "series points {ts,v:number}, ascending"),
  (.series) as $s | chk(.missing == [panels[] | select(($s[.] | length) == 0)]; "missing must list exactly the panels with no point"),
  chk(.cells | keys_are(["availability","availability_sec","outages","events","stats","timeline","bands","band_series","combos"]); "cells keys"),
  chk(all(.cells.availability[]; (.ts | isnum) and (.n | isnum) and (.up | isnum) and .up <= .n); "availability"),
  chk(all(.cells.outages[]; (.start_ts | isnum) and (.end_ts | isnum) and (.samples | isnum) and .start_ts <= .end_ts); "outages"),
  chk(all(.cells.events[]; (.ts | isnum) and (.changes | length > 0) and all(.changes[]; (.field | type == "string") and (.from | strnull) and (.to | strnull))); "events"),
  chk(all(.cells.stats[]; (.key | type == "string") and (.lte_pci | strnull) and (.lte_band | strnull) and (.lte_cellid | strnull)
      and (.samples | isnum) and (.nr_down | isnum) and (.nr_known | isnum) and .nr_known <= .samples and .nr_down <= .nr_known); "stats"),
  chk(all(.cells.timeline[]; (.start_ts | isnum) and (.end_ts | isnum) and (.samples | isnum) and (.lte_pci | strnull) and (.lte_band | strnull) and (.nr_band | strnull)
      and (.nr_avail_pct | numnull)); "timeline"),
  chk(all(.cells.bands[]; (.start_ts | isnum) and (.end_ts | isnum) and (.samples | isnum) and (.bands | strnull) and (.ca_cc | numnull) and (.bw_mhz | numnull)); "bands"),
  chk(all(.cells.band_series | to_entries[]; ((.key | .[0:1] | IN("B","N")) and ((.key | .[1:] | tonumber? // null) != null)) and (.value | pts and ascending and length > 0)); "band_series"),
  chk(all(.cells.combos[]; (.bands | strnull) and (.samples | isnum) and (.first_ts | isnum) and (.last_ts | isnum) and (.ca_cc | numnull) and (.bw_mhz | numnull)); "combos"),
  chk((.recorder | keys_are(["state","stale_sec","free_kb","archive_kb","oldest_ts","l1_enabled"]))
      and (.recorder.state | IN("ok","stale","low_space","empty","clock_unset")) and (.recorder.stale_sec | numnull) and (.recorder.free_kb | numnull)
      and (.recorder.archive_kb | isnum) and (.recorder.oldest_ts | numnull) and (.recorder.l1_enabled | type == "boolean"); "recorder"),
  chk(.device_utc_offset_min | isnum; "device_utc_offset_min"),
  chk(all(.carriers[]; ((.key | split(":")) as $p | ($p | length) == 3 and ($p[0] | IN("L","N")) and (($p[1] | tonumber? // null) != null) and (($p[2] | tonumber? // null) != null)) and (.tech | IN("LTE","NR")) and (.band | isnum) and (.arfcn | isnum) and (.bw_mhz | numnull)
      and (.role_pct_pcc | isnum) and .role_pct_pcc >= 0 and .role_pct_pcc <= 100 and (.samples | isnum)
      and all(.rsrp, .rsrq, .sinr, .rssi; pts and ascending)); "carriers"),
  chk(([.carriers[].samples] as $s | $s == ($s | sort | reverse)); "carriers not most-samples-first"),
  chk((.antennas | length <= 8) and all(.antennas[]; (.tech | IN("LTE","NR")) and (.port | IN(0,1,2,3)) and (.rsrp | pts and ascending and length > 0) and (.median | isnum)); "antennas"),
  chk(all(.congestion[]; (.ts | isnum) and (.prb_share | numnull) and (.prb_max_share | numnull) and (.dl_bps | numnull) and (.saturated | type == "boolean") and (.samples | isnum)
      and (.saturated == false or (.dl_bps != null and .dl_bps >= 20000000 and .samples >= 3))); "congestion"),
  chk(all(.restarts[]; (.boot_ts | isnum) and (.last_alive_ts | numnull) and (.down_sec | numnull) and (.cause | IN("power_loss","restart","planned","unknown"))); "restarts")
]
