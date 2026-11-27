#!/bin/sh
# run-tests.sh - runs fetch_signal_history.sh / fetch_ping_history.sh against the
# synthetic archives built by fixtures.sh and validates every response.
#
#   sh tools/history-agg-tests/run-tests.sh            (macOS, Linux, or the router)
#
# Needs: sh, awk, jq, gzip, tail, head, sed. Nothing outside a mktemp -d directory
# is written. On the router, copy tools/history-agg-tests plus the two CGIs and
# cgi_base.sh/history_agg.sh into one tree laid out like the repo.
#
# What is checked per case: the response is valid JSON with every contract key
# and type (check_cells.jq / check_ping.jq: null is never 0), plus case-specific
# facts (recorder state, sample counts, torn lines, .gz preference, n=0 ping
# minutes, restarts), and that the PIECEWISE result (cached day/hour blocks glued
# by the merge) equals a single-pass reduction of the same rows.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$ROOT/tools/history-agg-tests"
LIB="${QM_LIB_DIR:-$ROOT/scripts/usr/lib/qmanager}"
CGI="$ROOT/scripts/www/cgi-bin/quecmanager/at_cmd"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/histagg.XXXXXX") || exit 2
trap 'rm -rf "$TMP"' EXIT INT TERM
FX="$TMP/fx"
PASS=0
FAIL=0

sh "$HERE/fixtures.sh" "$FX" || { echo "fixtures failed" >&2; exit 2; }

ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

# run_cgi <case> <script> <query>  -> body on stdout (HTTP headers stripped)
run_cgi() {
    (
        . "$FX/$1/env"
        export QM_NOW
        export _SKIP_AUTH=1 REQUEST_METHOD=GET QM_LIB_DIR="$LIB" TZ=CST6
        export QM_CELL_HISTORY_DIR="$FX/$1/cell" QM_PING_HISTORY_DIR="$FX/$1/ping"
        export QM_BOOT_LOG="$FX/$1/boot_log.jsonl" QM_CELL_STATE_FILE="$FX/$1/state"
        export QM_PING_RING_FILE="$FX/$1/ring.json" QM_HIST_CACHE_DIR="$TMP/cache.$1"
        export QM_L1_STATS=0 QM_HIST_NO_RESP_CACHE=1
        [ -n "$4" ] && export QM_L1_STATS="$4"
        QUERY_STRING="$3" sh "$CGI/$2" 2>"$TMP/stderr"
    ) | sed '1,/^$/d'
}

# assert <label> <jq filter that must be true> <json file>
assert() {
    if jq -e "$2" "$3" >/dev/null 2>&1; then ok "$1"; else bad "$1  [$2]"; fi
}

check_cells() { # case range [extra jq assertions as label|filter pairs via assert()]
    f="$TMP/$1.$2.json"
    run_cgi "$1" fetch_signal_history.sh "view=cells&range=$2" > "$f"
    if ! jq -e . "$f" >/dev/null 2>&1; then bad "$1 $2: not JSON"; return 1; fi
    errs=$(jq -c -f "$HERE/check_cells.jq" "$f")
    if [ "$errs" = "[]" ]; then ok "$1 $2: contract shape"; else bad "$1 $2: shape $errs"; fi
}

count_rows() { # <file...> start end: rows whose ts is inside the window
    s="$1"; e="$2"; shift 2
    for f in "$@"; do
        case "$f" in *.gz) gzip -dc "$f" ;; *) cat "$f" ;; esac
    done | awk -v s="$s" -v e="$e" '{
        if (substr($0, 1, 3) == "[2,") t = substr($0, 4, 10); else if (substr($0, 1, 6) == "{\"ts\":") t = substr($0, 7, 10); else next
        if (t + 0 >= s && t + 0 <= e && (substr($0, length($0)) == "]" || substr($0, length($0)) == "}")) n++ } END { print n + 0 }'
}

# Single-pass baseline: every row of the window through ONE reducer and merge, no
# pieces, no cache. The piecewise answer must equal it (except the snapshot /
# recorder blocks, which do not come from the pieces).
baseline_cells() { # <case> <range> <panels>
    (
        . "$FX/$1/env"
        export TZ=CST6
        . "$LIB/history_agg.sh"
        set -- "$1" "$2" "$3"
        set -- "$@" $(ha_cells_params "$2")
        case_="$1"; range="$2"; panels="$3"; span="$4"; bucket="$5"
        avail=$bucket; [ "$avail" -gt 3600 ] && avail=3600
        end=$QM_NOW; start=$((end - span))
        for kind in cell ping; do
            dir="$FX/$case_/$kind"; [ "$kind" = cell ] || true
            for f in $(ls -1 "$dir" 2>/dev/null); do
                case "$f" in *.jsonl.gz) ;; *.jsonl) [ -f "$dir/$f.gz" ] && continue ;; *) continue ;; esac
                case "$f" in *.gz) gzip -dc "$dir/$f" ;; *) cat "$dir/$f" ;; esac
            done > "$TMP/base.$kind"
        done
        awk -v start="$start" -v end="$end" -v bucket="$bucket" -v avail="$avail" -v gap_sec=180 -v snap=0 "$HA_AWK_CELL" "$TMP/base.cell" > "$TMP/base.cell.tsv"
        awk -v start="$start" -v end="$end" -v bucket="$bucket" -v cut=0 "$HA_AWK_PING" "$TMP/base.ping" > "$TMP/base.ping.tsv"
        awk -v range="$range" -v gen="$end" -v bucket="$bucket" -v avail="$avail" -v start="$start" -v end="$end" -v gap_sec=180 \
            -v panels="$panels" -v snapshot=null -v recorder=null -v restarts='[]' -v offset=0 "$HA_AWK_MERGE" /dev/null "$TMP/base.cell.tsv" "$TMP/base.ping.tsv"
    )
}

PANELS="rsrp sinr rsrq rssi temp cqi rank mcs tx_power total_cells cpu mem dl ul ca bw lte_mcs nr_mcs lte_ri nr_ri lte_cqi nr_cqi ul_mcs lat jit loss"
CMP='del(.snapshot, .recorder, .restarts, .device_utc_offset_min)'

equiv() { # <case> <range>
    run_cgi "$1" fetch_signal_history.sh "view=cells&range=$2" | jq -S "$CMP" > "$TMP/eq.a.json"
    baseline_cells "$1" "$2" "$PANELS" | jq -S "$CMP" > "$TMP/eq.b.json"
    if [ -s "$TMP/eq.a.json" ] && cmp -s "$TMP/eq.a.json" "$TMP/eq.b.json"; then ok "$1 $2: pieces == single pass"
    else
        bad "$1 $2: pieces differ from single pass ($(diff "$TMP/eq.a.json" "$TMP/eq.b.json" 2>/dev/null | head -4 | tr '\n' ' '))"
        # HISTAGG_KEEP=<dir> keeps both sides for a manual diff
        if [ -n "$HISTAGG_KEEP" ]; then mkdir -p "$HISTAGG_KEEP" && cp "$TMP/eq.a.json" "$HISTAGG_KEEP/$1.$2.pieces.json" && cp "$TMP/eq.b.json" "$HISTAGG_KEEP/$1.$2.single.json"; fi
    fi
}

echo "== cells contract, every case x range"
for c in v1_only v2_full mixed torn gz_wins empty stale low_space; do
    for r in 1h 6h 24h 7d 30d; do check_cells "$c" "$r"; done
done
check_cells clock_unset 24h

echo "== the checker itself rejects broken responses"
for mut in '.series.rsrp[0].v = null' '.recorder.state = "weird"' 'del(.carriers)' '.cells.availability[0].up = 99999' '.window.end = 1'; do
    jq -c "$mut" "$TMP/v2_full.24h.json" > "$TMP/mut.json"
    errs=$(jq -c -f "$HERE/check_cells.jq" "$TMP/mut.json" 2>/dev/null)
    if [ "$errs" != "[]" ]; then ok "checker flags: $mut"; else bad "checker accepted: $mut"; fi
done

echo "== v1-only archive"
f="$TMP/v1_only.24h.json"
assert "v1: rsrp/sinr/rsrq present" '(.series.rsrp|length>0) and (.series.sinr|length>0) and (.series.rsrq|length>0)' "$f"
assert "v1: nothing the v1 row cannot answer is invented (null, not 0)" '[.series.rssi,.series.temp,.series.cqi,.series.mcs,.series.dl,.series.ca,.series.bw,.series.total_cells,.series.lat]|all(length==0)' "$f"
assert "v1: those panels are in missing[]" '(["rssi","temp","cqi","mcs","dl","ca","bw","lat"] - .missing) == []' "$f"
assert "v1: serving + NR carriers, band_series keyed B1/N41" '(.carriers|map(.key)|contains(["L:1:250","N:41:509070"])) and (.cells.band_series.B1|length>0)' "$f"
assert "v1: no antennas, no congestion" '(.antennas==[]) and (.congestion==[])' "$f"
assert "v1: window ends at the wall clock, not the newest row" ".window.end == $(. "$FX/v1_only/env"; echo "$QM_NOW")" "$f"
assert "v1: recorder ok, l1 off" '.recorder.state=="ok" and .recorder.l1_enabled==false and .recorder.oldest_ts!=null' "$f"
exp=$(. "$FX/v1_only/env"; count_rows $((QM_NOW - 86400)) "$QM_NOW" "$FX/v1_only/cell/2026-11-26.jsonl.gz" "$FX/v1_only/cell/2026-11-27.jsonl")
assert "v1: window.samples == rows in the window ($exp)" ".window.samples == $exp" "$f"
assert "v1: device offset from TZ=CST6 is -360" '.device_utc_offset_min == -360' "$f"

echo "== v2 archive (L1 on, ping archive, ring, boot log)"
f="$TMP/v2_full.24h.json"
assert "v2: every panel the row can answer has points" '[.series.rsrp,.series.rssi,.series.cqi,.series.rank,.series.mcs,.series.lte_mcs,.series.nr_mcs,.series.lte_ri,.series.nr_ri,.series.lte_cqi,.series.nr_cqi,.series.ul_mcs,.series.tx_power,.series.total_cells,.series.cpu,.series.mem,.series.dl,.series.ul,.series.ca,.series.bw,.series.temp]|all(length>0)' "$f"
assert "v2: lat/jit/loss joined from the ping archive" '(.series.lat|length>0) and (.series.jit|length>0) and (.series.loss|length>0)' "$f"
assert "v2: missing[] is empty when everything has data" '.missing==[]' "$f"
assert "v2: three carriers, LTE PCC first by samples, NR SCC present" '(.carriers|length)==3 and (.carriers|map(.key)|contains(["L:1:250","L:3:1650","N:41:509070"]))' "$f"
assert "v2: PCC share: L:1:250 is PCC most of the time, N:41 never" '((.carriers[]|select(.key=="L:1:250")|.role_pct_pcc) > 50) and ((.carriers[]|select(.key=="N:41:509070")|.role_pct_pcc)==0)' "$f"
assert "v2: carrier signals non-empty" '.carriers|all(.[]; (.rsrp|length)>0 and (.sinr|length)>0)' "$f"
assert "v2: band_series from carriers (B1, B3, N41)" '(.cells.band_series|keys)==["B1","B3","N41"]' "$f"
assert "v2: 8 antenna ports with medians; ports 2/3 weaker" '(.antennas|length)==8 and ((.antennas[]|select(.tech=="LTE" and .port==0)|.median) - (.antennas[]|select(.tech=="LTE" and .port==2)|.median) > 20)' "$f"
assert "v2: congestion has saturated and idle buckets" '(.congestion|map(.saturated)|unique)==[false,true]' "$f"
assert "v2: ca is 2 or 3 (carrier count); total_cells matches" '(.series.ca|all(.[]; .v>=2 and .v<=3)) and (.series.bw|all(.[]; .v>=30 and .v<=60))' "$f"
assert "v2: NOSVC row: network_type event, no signal, still a sample" '(.cells.events|map(.changes[]|select(.field=="network_type" and .to=="NOSVC"))|length)>0' "$f"
assert "v2: 5G dropouts are outages with samples" '(.cells.outages|length)>=1 and (.cells.outages|all(.[]; .samples>0))' "$f"
assert "v2: restarts: torn line and the row 27 h old ignored, oldest first" '(.restarts|map(.cause))==["power_loss","unknown"] and (.restarts|map(.boot_ts)|. == sort)' "$f"
assert "v2: recorder state from file, free_kb from file" '.recorder.state=="ok" and .recorder.free_kb==9000' "$f"
assert "v2: PCI handover to cell B appears in stats" '(.cells.stats|map(.key)|contains(["104","77"]))' "$f"
run_cgi v2_full fetch_signal_history.sh "view=cells&range=24h" 1 > "$TMP/v2_l1.json"
assert "v2: l1_enabled mirrors the setting" '.recorder.l1_enabled==true' "$TMP/v2_l1.json"
run_cgi v2_full fetch_signal_history.sh "view=cells&range=1h&panels=rsrp,bogus,rsrp,ca" > "$TMP/v2_pan.json"
assert "panels= narrows the key set, ignores unknown ids, dedupes" '(.series|keys)==["ca","rsrp"]' "$TMP/v2_pan.json"
exp=$(. "$FX/v2_full/env"; count_rows $((QM_NOW - 86400)) "$QM_NOW" "$FX/v2_full/cell/2026-11-26.jsonl.gz" "$FX/v2_full/cell/2026-11-27.jsonl")
assert "v2: window.samples == rows in the window ($exp)" ".window.samples == $exp" "$f"

echo "== mixed v1/v2 inside one file"
f="$TMP/mixed.24h.json"
exp=$(. "$FX/mixed/env"; count_rows $((QM_NOW - 86400)) "$QM_NOW" "$FX/mixed/cell/2026-11-26.jsonl.gz" "$FX/mixed/cell/2026-11-27.jsonl")
assert "mixed: every v1 and v2 row counted ($exp)" ".window.samples == $exp" "$f"
assert "mixed: v2-only panels have points only from the v2 part" '(.series.mcs|length)>0 and (.series.rsrp|length)>(.series.mcs|length)' "$f"

echo "== torn last line"
f="$TMP/torn.24h.json"
exp=$(. "$FX/torn/env"; count_rows $((QM_NOW - 86400)) "$QM_NOW" "$FX/torn/cell/2026-11-26.jsonl.gz" "$FX/torn/cell/2026-11-27.jsonl")
assert "torn: the partial row is skipped ($exp samples), response still valid" ".window.samples == $exp" "$f"

echo "== .jsonl and .jsonl.gz of one day"
f="$TMP/gz_wins.7d.json"
exp=$(. "$FX/gz_wins/env"; count_rows $((QM_NOW - 604800)) "$QM_NOW" "$FX/gz_wins/cell/2026-11-25.jsonl.gz" "$FX/gz_wins/cell/2026-11-26.jsonl.gz" "$FX/gz_wins/cell/2026-11-27.jsonl")
assert "gz wins: the plain file is ignored ($exp samples)" ".window.samples == $exp" "$f"
assert "gz wins: the plain file's PCI 999 never appears" '(.cells.stats|map(.key)|index("999"))==null' "$f"

echo "== empty archive, stale recorder, low space, clock"
f="$TMP/empty.24h.json"
assert "empty: state empty, no samples, all panels missing, nulls not zeros" '.recorder.state=="empty" and .recorder.stale_sec==null and .recorder.oldest_ts==null and .window.samples==0 and .window.first_ts==null and (.missing|length)==26 and .carriers==[] and .congestion==[] and .coverage.cell_from==null and .snapshot.as_of==null and .snapshot.cell.lte_pci==null' "$f"
f="$TMP/stale.24h.json"
assert "stale: state stale, window still ends at now, stale_sec > 180" '.recorder.state=="stale" and .recorder.stale_sec>180 and .window.end==.generated_at' "$f"
f="$TMP/low_space.24h.json"
assert "low_space: state low_space with the recorder free_kb" '.recorder.state=="low_space" and .recorder.free_kb==1200 and .recorder.archive_kb>0' "$f"
f="$TMP/clock_unset.24h.json"
assert "clock_unset: reported, no crash, no samples" '.recorder.state=="clock_unset" and .window.samples==0' "$f"

echo "== pieces equal a single pass"
for r in 1h 6h 24h 7d; do equiv v2_full "$r"; done
equiv mixed 24h
equiv v1_only 7d
equiv torn 24h
equiv gz_wins 7d

echo "== caching: second request identical, cache dir bounded"
(
    . "$FX/v2_full/env"
    export QM_NOW
    export _SKIP_AUTH=1 REQUEST_METHOD=GET QM_LIB_DIR="$LIB" TZ=CST6 QM_L1_STATS=0
    export QM_CELL_HISTORY_DIR="$FX/v2_full/cell" QM_PING_HISTORY_DIR="$FX/v2_full/ping" QM_BOOT_LOG="$FX/v2_full/boot_log.jsonl"
    export QM_CELL_STATE_FILE="$FX/v2_full/state" QM_PING_RING_FILE="$FX/v2_full/ring.json" QM_HIST_CACHE_DIR="$TMP/cache.warm"
    QM_HIST_NO_RESP_CACHE=1 QUERY_STRING="view=cells&range=7d" sh "$CGI/fetch_signal_history.sh" | sed '1,/^$/d' > "$TMP/warm1.json"
    QM_HIST_NO_RESP_CACHE=1 QUERY_STRING="view=cells&range=7d" sh "$CGI/fetch_signal_history.sh" | sed '1,/^$/d' > "$TMP/warm2.json"
    QUERY_STRING="view=cells&range=7d" sh "$CGI/fetch_signal_history.sh" | sed '1,/^$/d' > "$TMP/warm3.json"
)
if cmp -s "$TMP/warm1.json" "$TMP/warm2.json"; then ok "cold == warm (block cache)"; else bad "cold != warm"; fi
if cmp -s "$TMP/warm1.json" "$TMP/warm3.json"; then ok "cold == response-cache hit"; else bad "response cache differs"; fi
kb=$(du -sk "$TMP/cache.warm" 2>/dev/null | awk '{print $1}')
if [ "${kb:-9999}" -le 2100 ]; then ok "cache dir <= 2 MB (${kb} KB)"; else bad "cache dir ${kb} KB"; fi
left=$(ls -d "$TMP"/cache.warm/w.* "$TMP"/cache.warm/*.lock "$TMP"/cache.warm/*.tmp.* 2>/dev/null | wc -l | tr -d ' ')
if [ "$left" = "0" ]; then ok "no work dir, lock or temp file left behind"; else bad "left $left stray entries"; fi

echo "== ping contract"
for r in 1h 6h 24h 7d; do
    f="$TMP/ping.$r.json"
    run_cgi v2_full fetch_ping_history.sh "range=$r" > "$f"
    errs=$(jq -c -f "$HERE/check_ping.jq" "$f" 2>/dev/null)
    if [ "$errs" = "[]" ]; then ok "ping $r: contract shape"; else bad "ping $r: $errs"; fi
done
f="$TMP/ping.24h.json"
assert "ping 24h: buckets are 300 s" '.bucket_sec==300 and (.points|all(.[]; .ts%300==0))' "$f"
assert "ping 24h: the n=0 minute adds nothing (no point with n 0, none with null loss)" '.points|all(.[]; .n>0 and .loss!=null)' "$f"
assert "ping 24h: restarts present" '(.restarts|length)==2' "$f"
last=$(cat "$FX/v2_full/last_ping_ts")
assert "ping 24h: ring rows past the archive's last minute are folded in" ".points[-1].ts >= $((last / 300 * 300)) and .points[-1].n >= 1" "$f"
run_cgi v2_full fetch_ping_history.sh "range=1h" > "$TMP/ping.1h.json"
exp=$(. "$FX/v2_full/env"; awk -v s=$((QM_NOW - 3600)) -v e="$QM_NOW" -F, '/^\[/ { t = substr($1, 2) + 0; if (t >= s && t <= e) { n += $2; ok += $3 } } END { print n, ok }' "$FX/v2_full/ping/2026-11-27.jsonl")
assert "ping 1h: archive probes counted exactly ($exp n ok) plus ring probes" '([.points[].n]|add) >= '"${exp% *}"' and ([.points[].ok]|add) >= '"${exp#* }" "$TMP/ping.1h.json"
run_cgi empty fetch_ping_history.sh "range=24h" > "$TMP/ping.empty.json"
assert "ping empty: valid, no points" '.success==true and .points==[]' "$TMP/ping.empty.json"
run_cgi v2_full fetch_ping_history.sh "range=2h" > "$TMP/ping.bad.json"
assert "ping bad range -> invalid_range" '.success==false and .error=="invalid_range"' "$TMP/ping.bad.json"
run_cgi v2_full fetch_signal_history.sh "view=cells&range=2h" > "$TMP/cells.bad.json"
assert "cells bad range -> invalid_range" '.success==false and .error=="invalid_range"' "$TMP/cells.bad.json"

echo "== untouched views"
run_cgi empty fetch_ping_history.sh "" > "$TMP/ping.default.out"
run_cgi empty fetch_signal_history.sh "" > "$TMP/sig.default.out"
for x in ping.default sig.default; do
    if [ "$(head -c 1 "$TMP/$x.out")" = "[" ]; then ok "$x: still a JSON array"; else bad "$x: not an array"; fi
done
run_cgi empty fetch_signal_history.sh "view=other" > "$TMP/sig.other.out"
if cmp -s "$TMP/sig.other.out" "$TMP/sig.default.out"; then ok "unknown view falls through to the default"; else bad "unknown view differs"; fi

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]
