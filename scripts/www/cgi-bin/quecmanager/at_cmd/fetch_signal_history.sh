#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# fetch_signal_history.sh — signal history chart data + cell history
# =============================================================================
# Two views of two different records. The default one is unchanged.
#
#   (no query)                       -> /tmp/qmanager_signal_history.json as a
#                                       JSON array: the last 2 minutes of
#                                       per-antenna signal, from RAM. Dashboard
#                                       chart only.
#   ?view=cells&range=<range>        -> the DERIVED cell-history contract (series
#                                       per panel + availability/outage/timeline/
#                                       band shapes) for that window. 1h..30d.
#
# The default view is a 2-minute RAM ring, so it can answer "what is the signal
# doing" and nothing else. "5G was gone at 03:00 — on which cell?" needs the
# durable archive (/usrdata/qmanager/cell_history/YYYY-MM-DD.jsonl, one row a
# minute, written by qmanager_poller's append_cell_history), which is what
# ?view=cells reads. It rides this endpoint rather than adding a second CGI: one
# reader, one auth envelope, one place that knows the range vocabulary.
#
# The cells view AGGREGATES - it does not serve rows. Change 41 replaced the
# page with greenpacket-o5a's, whose contract is derived shapes (series per panel,
# window, coverage, snapshot, availability buckets, outage spans, cell runs,
# per-cell stats, band runs/combos). One awk pass over the window emits tagged
# TSV records and one jq pass shapes them, so jq never sees a row and the client
# never sees one either. Panels this archive cannot answer (rssi/temp/cqi/rank/
# mcs/tx_power/total_cells/cpu/mem/dl/ul/ca/bw) are reported through `missing[]`
# rather than drawn at zero.
#
# Endpoint: GET /cgi-bin/quecmanager/at_cmd/fetch_signal_history.sh[?view=cells&range=]
# Response: application/json
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/fetch_signal_history.sh
# =============================================================================

SIGNAL_HISTORY_FILE="/tmp/qmanager_signal_history.json"
CELL_HISTORY_DIR="${QM_CELL_HISTORY_DIR:-/usrdata/qmanager/cell_history}"

SANE_EPOCH=1700000000
CELL_HISTORY_INTERVAL=60      # qmanager_poller's row cadence, reported to the client

# One row, whole-line. A torn final line (a write interrupted by power loss) must
# never reach the client: it parses as invalid JSON and breaks the page, so the
# filter matches the FULL shape of what qmanager_poller's append_cell_history
# writes rather than a prefix. Braces are written as [{}] because both BSD and
# BusyBox awk treat a bare `{` as an interval expression.
NUM_RE='(-?[0-9]+([.][0-9]+)?|null)'
STR_RE='("[A-Za-z0-9_.-]*"|null)'
CELL_ROW_RE="^[{]\"ts\":[0-9]+,\"rat\":$STR_RE,\"lte_pci\":$NUM_RE,\"lte_band\":$STR_RE,\"lte_earfcn\":$NUM_RE,\"lte_bw\":$NUM_RE,\"lte_cell_id\":$NUM_RE,\"lte_tac\":$NUM_RE,\"nr_pci\":$NUM_RE,\"nr_band\":$STR_RE,\"nr_arfcn\":$NUM_RE,\"nr_cell_id\":$NUM_RE,\"nr_tac\":$NUM_RE,\"nr_avail\":(0|1|null),\"rsrp\":$NUM_RE,\"rsrq\":$NUM_RE,\"sinr\":$NUM_RE[}]$"

qlog_init "cgi_fetch_signal_history"
cgi_headers
cgi_handle_options

# The default view: the dashboard's 2-minute per-antenna ring, byte-identical to
# what this endpoint served before the cells view existed.
serve_signal_history() {
    serve_ndjson_as_array "$SIGNAL_HISTORY_FILE"
}

# yyyy-mm-dd -> yyyymmdd for numeric comparison (ash `[` has no string <).
daynum() {
    local y="${1%%-*}"
    local r="${1#*-}"
    printf '%s%s%s' "$y" "${r%%-*}" "${r#*-}"
}

# =============================================================================
# The cells view - the REFERENCE BUILD'S AGGREGATING CONTRACT, built from our
# own archive. (greenpacket-o5a's page is the consumer; this is the backend it
# needs. Change 41 copied that page; this function is what makes it live.)
#
# The wire shape is derived, not rows:
#
#   {bucket_sec, window{start,end,samples,first_ts,last_ts},
#    coverage{cell_from}, snapshot{carrier,registered,cell{...},as_of},
#    series{<panel>:[{ts,v}]}, missing[<panel>],
#    cells{availability[], availability_sec, outages[], events[], stats[],
#          timeline[], bands[], band_series{}, combos[]}}
#
# One awk pass over the window emits tagged TSV records and ONE jq pass shapes
# them - jq never sees an archive row. `band_series` is `{}` because it needs a
# per-carrier `cc_sig` column this archive does not carry, and `phy`-class panels
# (cqi/rank/mcs/tx_power) are reported through `missing[]`: the reference
# collects those over QMI, this box is AT-only. An absent value is an EMPTY
# field on the wire -> null in JSON, never 0.
# =============================================================================

# Panels this archive can actually answer. The rest of the reference's panel list
# is still requested below, so `missing[]` names them and the page disables the
# pill instead of drawing an empty chart.
CELL_SERVED_PANELS="rsrp sinr rsrq"
# The full reference vocabulary - the key set of `series`, and the source of
# `missing[]`. Kept in step with `types/cell-history.ts` CELL_HISTORY_PANELS.
CELL_ALL_PANELS="rsrp sinr rsrq rssi temp cqi rank mcs tx_power total_cells cpu mem dl ul ca bw"

# range -> "<span seconds> <series bucket seconds>". Buckets keep a window at a
# few hundred points: 24h at 300 s is 288, 7d at 1800 s is 336, 30d at 7200 s 360.
cells_range_params() {
    case "$1" in
        1h)  printf '%s %s' 3600 60 ;;
        3h)  printf '%s %s' 10800 60 ;;
        6h)  printf '%s %s' 21600 120 ;;
        12h) printf '%s %s' 43200 240 ;;
        24h) printf '%s %s' 86400 300 ;;
        7d)  printf '%s %s' 604800 1800 ;;
        30d) printf '%s %s' 2592000 7200 ;;
        *) return 1 ;;
    esac
}

# One row -> tagged records. Tags: V series point, A availability bucket,
# E identity change, O outage span, S per-cell stat, T serving-cell run,
# B band-combo run, K combo rollup, W window, C coverage.
AWK_CELLS='
function gv(s, k,   m) {
    if (!match(s, "\"" k "\":[^,}]*")) return ""
    m = substr(s, RSTART, RLENGTH)
    sub("\"" k "\":", "", m)
    if (substr(m, 1, 1) == "\"") { sub(/^"/, "", m); sub(/"$/, "", m) }
    if (m == "null") return ""
    return m
}
function num(v) { return (v != "" && v ~ /^-?[0-9]+([.][0-9]+)?$/) ? v + 0 : "" }
function dedupe(s,   out, i, n, a, tok) {
    if (s == "" || index(s, "+") == 0) return s
    n = split(s, a, "+"); out = ""
    for (i = 1; i <= n; i++) {
        tok = a[i]
        if (tok == "") continue
        if (index("+" out "+", "+" tok "+") > 0) continue
        out = (out == "") ? tok : out "+" tok
    }
    return out
}
function close_out() { if (in_out) printf "O\t%d\t%d\t%d\n", out_start, out_end, out_n; in_out = 0; out_n = 0 }
function close_run() {
    if (run_n > 0) printf "T\t%d\t%d\t%d\t%s\t%s\t%s\t%d\t%d\n", run_start, run_end, run_n, run_lpci, run_lband, run_nband, run_known, run_up
    run_n = 0; run_known = 0; run_up = 0
}
function close_band() { if (bn > 0) printf "B\t%d\t%d\t%d\t%s\t%s\t%s\n", b_start, b_end, bn, b_key, b_ca, b_bw; bn = 0 }
BEGIN {
    gap = gap_sec + 0; if (gap <= 0) gap = 180
    ab = avail_sec + 0; if (ab <= 0) ab = 60
    NFIELDS = split("nr_avail lte_pci lte_band lte_earfcn lte_bw nr_pci nr_band nr_arfcn lte_cellid nr_cellid network_type bands", FIELD)
    PVP["rsrp"] = "rsrp"; PVP["sinr"] = "sinr"; PVP["rsrq"] = "rsrq"
    had_prev = 0; in_out = 0; out_n = 0; run_n = 0; bn = 0; nW = 0; cov_from = ""
}
{
    if (!match($0, /"ts":[0-9]+/)) next
    t = substr($0, RSTART + 5, RLENGTH - 5) + 0
    if (t <= 0 || t < start || t > end) next
    nrp = gv($0, "nr_pci"); nrb = gv($0, "nr_band"); lteb = gv($0, "lte_band")
    bands = (nrb == "" ? lteb : (lteb == "" ? nrb : lteb "+" nrb))
    bands = dedupe(bands)
    V["nr_avail"] = gv($0, "nr_avail"); V["lte_pci"] = gv($0, "lte_pci"); V["lte_band"] = lteb
    V["lte_earfcn"] = gv($0, "lte_earfcn"); V["lte_bw"] = gv($0, "lte_bw"); V["nr_pci"] = nrp
    V["nr_band"] = nrb; V["nr_arfcn"] = gv($0, "nr_arfcn"); V["lte_cellid"] = gv($0, "lte_cell_id")
    V["nr_cellid"] = gv($0, "nr_cell_id"); V["network_type"] = gv($0, "rat"); V["bands"] = bands

    nW++; if (nW == 1) Wfirst = t; Wlast = t
    if (cov_from == "" && (V["lte_pci"] != "" || V["nr_pci"] != "" || lteb != "" || nrb != "")) cov_from = t

    b = int(t / bucket) * bucket
    for (p in PVP) { v = num(gv($0, PVP[p])); if (v != "") { N[p, b]++; S[p, b] += v } }

    if (V["nr_avail"] != "") { k = int(t / ab) * ab; A_n[k]++; if (V["nr_avail"] == "1") A_up[k]++ }

    if (in_out && t - out_end > gap) close_out()
    if (V["nr_avail"] == "0") {
        if (!in_out) { in_out = 1; out_start = t }
        out_end = t; out_n++
    } else if (V["nr_avail"] == "1" && in_out) close_out()

    cur = V["lte_pci"] "|" V["lte_band"] "|" V["nr_band"]
    if (run_n > 0 && (cur != run_key || t - run_end > gap)) close_run()
    if (run_n == 0) { run_start = t; run_lpci = V["lte_pci"]; run_lband = V["lte_band"]; run_nband = V["nr_band"]; run_key = cur }
    run_end = t; run_n++
    if (V["nr_avail"] != "") { run_known++; if (V["nr_avail"] == "1") run_up++ }

    if (bn > 0 && (bands != b_key || t - b_end > gap)) close_band()
    if (bn == 0) { b_start = t; b_key = bands; b_ca = ""; b_bw = num(V["lte_bw"]) }
    b_end = t; bn++

    if (bands != "") { if (!(bands in Bcomb)) Bfirst[bands] = t; Bcomb[bands]++; Blast[bands] = t }

    ck = (V["lte_pci"] == "" ? "(none)" : V["lte_pci"])
    if (!(ck in K_n)) { K_band[ck] = V["lte_band"]; K_cid[ck] = V["lte_cellid"]; K_first[ck] = t }
    K_n[ck]++; K_last[ck] = t
    if (V["nr_avail"] != "") { K_known[ck]++; if (V["nr_avail"] == "0") K_down[ck]++ }

    for (i = 1; i <= NFIELDS; i++) {
        kk = FIELD[i]; vv = V[kk]
        if (had_prev && vv != PV[kk] && (PV[kk] != "" || vv != "")) printf "E\t%d\t%s\t%s\t%s\n", t, kk, PV[kk], vv
    }
    for (i = 1; i <= NFIELDS; i++) PV[FIELD[i]] = V[FIELD[i]]
    had_prev = 1
}
END {
    close_out(); close_run(); close_band()
    printf "W\t%d\t%d\t%d\n", nW, Wfirst, Wlast
    printf "C\t%s\n", cov_from
    for (k in A_n) printf "A\t%d\t%d\t%d\n", k, A_n[k], A_up[k]
    for (k in K_n) printf "S\t%s\t%s\t%s\t%d\t%d\t%d\t%d\t%d\n", k, K_band[k], K_cid[k], K_n[k], K_down[k], K_known[k], K_first[k], K_last[k]
    for (k in N) { split(k, kb, SUBSEP); printf "V\t%s\t%d\t%.1f\n", kb[1], kb[2], S[k] / N[k] }
    for (k in Bcomb) printf "K\t%s\t%d\t%d\t%d\t%s\t%s\n", k, Bcomb[k], Bfirst[k], Blast[k], "", ""
}
'

# The shaper. Lifted from the reference build (it IS the contract) and fed our
# arguments; it only groups, sorts and shapes the tagged records above.
JQ_CELLS='
def s0: if . == "" then null else . end;
def n0: if . == "" or . == "0" then null else (tonumber) end;
def n1: if . == "" then null else (tonumber) end;
[inputs | split("\t")] as $rows
| ([$rows[] | select(.[0] == "V") | {p: .[1], ts: (.[2] | tonumber), v: (.[3] | tonumber)}]) as $pts
| ($pts | group_by(.p) | map({key: .[0].p, value: (map({ts: .ts, v: .v}) | sort_by(.ts))}) | from_entries) as $series
| ($rows | map(select(.[0] == "W")) | (.[0] // [])) as $w
| ($rows | map(select(.[0] == "C")) | (.[0] // [])) as $cov
| ([$rows[] | select(.[0] == "A") | {ts: (.[1] | tonumber), n: (.[2] | tonumber), up: (.[3] | tonumber)}] | sort_by(.ts)) as $avail
| ([$rows[] | select(.[0] == "O") | {start_ts: (.[1] | tonumber), end_ts: (.[2] | tonumber), samples: (.[3] | tonumber)}] | sort_by(.start_ts)) as $outages
| ([$rows[] | select(.[0] == "B") | {start_ts: (.[1] | tonumber), end_ts: (.[2] | tonumber), samples: (.[3] | tonumber), bands: (.[4] | s0), ca_cc: (.[5] | n1), bw_mhz: (.[6] | n1)}] | sort_by(.start_ts)) as $bandruns
| ([$rows[] | select(.[0] == "K") | {bands: (.[1] | s0), samples: (.[2] | tonumber), first_ts: (.[3] | tonumber), last_ts: (.[4] | tonumber), ca_cc: (.[5] | n1), bw_mhz: (.[6] | n1)}] | sort_by(-.samples)) as $combos
| ([$rows[] | select(.[0] == "E") | {ts: (.[1] | tonumber), field: .[2], from: (.[3] | s0), to: (.[4] | s0)}] | group_by(.ts) | map({ts: .[0].ts, changes: map({field: .field, from: .from, to: .to})}) | sort_by(.ts) | reverse) as $events
| ([$rows[] | select(.[0] == "S") | {key: .[1], lte_pci: (.[1] | s0 | if . == "(none)" then null else . end), lte_band: (.[2] | s0), lte_cellid: (.[3] | s0), samples: (.[4] | tonumber), nr_down: (.[5] | tonumber), nr_known: (.[6] | tonumber), first_ts: (.[7] | tonumber), last_ts: (.[8] | tonumber)}] | sort_by(-.samples)) as $stats
| ([$rows[] | select(.[0] == "T") | {start_ts: (.[1] | tonumber), end_ts: (.[2] | tonumber), samples: (.[3] | tonumber), lte_pci: (.[4] | s0), lte_band: (.[5] | s0), nr_band: (.[6] | s0), known: (.[7] | tonumber), up: (.[8] | tonumber)}] | sort_by(.start_ts)) as $runs
| {success: true, view: "cells", range: $range, generated_at: $gen, bucket_sec: $bucket,
   window: {start: $start, end: $end, samples: (($w[1] // "0") | tonumber), first_ts: (($w[2] // "") | n0), last_ts: (($w[3] // "") | n0)},
   coverage: {cell_from: (($cov[1] // "") | s0 | if . == null then null else tonumber end)},
   snapshot: ($snapshot + {cell: $cell, as_of: (($w[3] // "") | n0)}),
   series: ($panels | map(. as $p | {key: $p, value: ($series[$p] // [])}) | from_entries),
   missing: [$panels[] | select((($series[.] // []) | length) == 0)],
   cells: {availability: $avail, availability_sec: $avail_sec, outages: $outages, events: $events, stats: $stats,
           timeline: ($runs | map(. as $r | {start_ts: $r.start_ts, end_ts: $r.end_ts, samples: $r.samples, lte_pci: $r.lte_pci, lte_band: $r.lte_band, nr_band: $r.nr_band, nr_avail_pct: (if $r.known > 0 then (($r.up * 100 / $r.known) | floor) else null end)})),
           bands: $bandruns, band_series: {}, combos: $combos}}
'

serve_cells() {
    local range params span bucket now last end start avail_sec sane
    local panels panel_list files cell snapshot

    range=24h
    case "&$QUERY_STRING" in
        *"&range="*)
            range="${QUERY_STRING#*range=}"
            range="${range%%&*}"
            ;;
    esac
    if ! params=$(cells_range_params "$range"); then
        cgi_error "invalid_range" "range must be 1h, 3h, 6h, 12h, 24h, 7d or 30d"
        return
    fi
    # shellcheck disable=SC2086
    set -- $params
    span=$1
    bucket=$2
    avail_sec=$bucket
    [ "$avail_sec" -gt 3600 ] 2>/dev/null && avail_sec=3600

    # ?panels= narrows the KEY SET; unknown ids are ignored and an id we cannot
    # answer still lands in missing[] (the reference's pill rule).
    panel_list=""
    case "&$QUERY_STRING" in
        *"&panels="*)
            panel_list="${QUERY_STRING#*panels=}"
            panel_list="${panel_list%%&*}"
            panel_list=$(printf '%s' "$panel_list" | tr ',' ' ')
            ;;
    esac
    if [ -z "$panel_list" ]; then
        panels="$CELL_ALL_PANELS"
    else
        for p in $panel_list; do
            case " $CELL_ALL_PANELS " in
                *" $p "*) panels="$panels $p" ;;
            esac
        done
        panels="${panels# }"
        [ -n "$panels" ] || panels="$CELL_ALL_PANELS"
    fi

    now=$(date +%s)
    case "$now" in ''|*[!0-9]*) now=0 ;; esac
    sane=true
    [ "$now" -lt "$SANE_EPOCH" ] && sane=false

    # Window end = the newest archived row, never the wall clock: a poller that
    # stopped an hour ago must show its last hour, not an hour of nothing.
    last=$(ls -1t "$CELL_HISTORY_DIR"/*.jsonl 2>/dev/null | head -1)
    end=""
    [ -n "$last" ] && end=$(tail -n 1 "$last" 2>/dev/null | sed 's/^{"ts":\([0-9]*\).*/\1/')
    case "$end" in ''|*[!0-9]*) end="" ;; esac
    { [ -z "$end" ] || [ "$end" -gt "$now" ]; } && end=$now
    start=$(( end - span ))

    # Snapshot: the newest row's identity. `carrier`/`registered` are not in this
    # archive, so they stay null rather than guessed.
    snapshot='{"carrier":null,"registered":null}'
    cell='null'
    if [ -n "$last" ]; then
        cell=$(tail -n 1 "$last" 2>/dev/null | jq -c '
            def s0: if . == null then null else (tostring) end;
            {lte_pci: .lte_pci, lte_earfcn: .lte_earfcn, lte_band: (.lte_band | s0),
             lte_bw: .lte_bw, lte_cellid: .lte_cell_id, lte_tac: .lte_tac,
             nr_pci: .nr_pci, nr_arfcn: .nr_arfcn, nr_band: (.nr_band | s0),
             nr_bw: null, nr_cellid: .nr_cell_id, nr_tac: .nr_tac,
             network_type: (.rat | s0), registered: null, nr_avail: .nr_avail}' 2>/dev/null)
        case "$cell" in "{"*) ;; *) cell='null' ;; esac
    fi

    files=$(ls -1 "$CELL_HISTORY_DIR"/*.jsonl 2>/dev/null)
    if [ "$sane" = "false" ] || [ -z "$files" ]; then
        printf '' | jq -nR --argjson snapshot "$snapshot" --argjson cell "$cell" \
            --arg range "$range" --argjson gen "$now" --argjson bucket "$bucket" \
            --argjson panels "$(printf '%s\n' "$panels" | jq -Rc 'split(" ")')" \
            --argjson start "$start" --argjson end "$end" \
            --argjson avail_sec "$avail_sec" "$JQ_CELLS"
        return
    fi

    # shellcheck disable=SC2086
    cat $files 2>/dev/null | awk -v start="$start" -v end="$end" -v bucket="$bucket" \
        -v avail_sec="$avail_sec" -v gap_sec=180 "$AWK_CELLS" \
        | jq -nR --argjson snapshot "$snapshot" --argjson cell "$cell" \
            --arg range "$range" --argjson gen "$now" --argjson bucket "$bucket" \
            --argjson panels "$(printf '%s\n' "$panels" | jq -Rc 'split(" ")')" \
            --argjson start "$start" --argjson end "$end" \
            --argjson avail_sec "$avail_sec" "$JQ_CELLS"
}

case "&$QUERY_STRING" in
    *"&view=cells"*) serve_cells ;;
    *) serve_signal_history ;;
esac
exit 0
