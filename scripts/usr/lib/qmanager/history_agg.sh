#!/bin/sh
# =============================================================================
# history_agg.sh - read-side aggregator for the cell and ping archives
# =============================================================================
# Sourced by fetch_signal_history.sh (?view=cells) and fetch_ping_history.sh
# (?range=). Not executable on its own. Contract: types/cell-history.ts and
# types/ping-history.ts; design: docs/plans/2026-11-27-history-v3.md section 4.
#
# Inputs (every path is overridable so tools/history-agg-tests runs on fixtures):
#   QM_CELL_HISTORY_DIR  /usrdata/qmanager/cell_history   YYYY-MM-DD.jsonl[.gz]
#   QM_PING_HISTORY_DIR  /usrdata/qmanager/ping_history   YYYY-MM-DD.jsonl[.gz]
#   QM_BOOT_LOG          /usrdata/qmanager/boot_log.jsonl
#   QM_CELL_STATE_FILE   /tmp/qmanager_cell_history_state (recorder state)
#   QM_PING_RING_FILE    /tmp/qmanager_ping_history.json  (10 s tmpfs ring)
#   QM_HIST_CACHE_DIR    /tmp/qmanager_hist_cache
#   QM_NOW               epoch override (tests)
#   QM_L1_STATS          "1"/"0" override of quecmanager.history.l1_stats
#   QM_HIST_NO_RESP_CACHE  non-empty: never reuse a response (benchmarks)
#   QM_HIST_BUILD_BUDGET   seconds a request may spend building cache blocks
#   QM_HIST_CACHE_CAP_KB   block cache cap in KB (default 3072; tests shrink it)
#   QM_HIST_BUILD_LOG      file: one "built <block>" line appended per block reduced
#                          (tests assert a request was served from blocks)
#
# WHY IT IS SHAPED LIKE THIS. The old CGI spent 20 s of CPU per poll matching a
# dynamic regex per field per row. BusyBox awk costs ~3 us per operation, so even
# a positional parse is ~1 ms a row, and a 24 h window is 1440 rows. The only way
# to be fast is to never reduce the same row twice:
#
#   1. The window is cut into PIECES on hour (or, for 2 h buckets, 2 h) edges:
#      whole closed days (D), whole sealed units (H) and the partial edges (L).
#      Bucket sizes all divide the unit, so no bucket straddles two pieces.
#   2. A D or H piece is reduced ONCE by awk into a small tagged TSV and kept in
#      $QM_HIST_CACHE_DIR (name carries day, bucket, unit offset and a reducer
#      version). The L pieces (window start, "now") are reduced live: <= ~120 rows.
#   3. The reducer emits series as ALREADY-RENDERED JSON point lists, so the merge
#      awk only concatenates strings and joins the row-level spans (outages, runs,
#      events) that cross piece edges. No jq on the hot path.
#   4. First use after a boot has nothing cached. A request may spend a build
#      budget (default 12 s) on the NEWEST missing pieces; whatever is left is
#      finished by a detached low-priority builder and shows on a later poll
#      (window.first_ts reports the span actually covered).
#
# Averages are always sum/count over NON-NULL readings: an absent value is null
# on the wire and in every sum, never 0.
# =============================================================================

HA_CACHE_VER="v2"
HA_SANE_EPOCH=1704067200      # 2024-01-01: before this the clock never synced
HA_GAP_SEC=180                # GAP_THRESHOLD_SECONDS in types/cell-history.ts
HA_CACHE_CAP_KB=3072          # reduced blocks only: resp_* files never count against it
HA_RESP_MAX_AGE=120           # a response file older than this is dead weight, deleted on every eviction pass
HA_WORK_MAX_AGE=600           # a w.<pid> / wb.<pid> work dir older than this is an orphan
HA_RESP_TTL_CELLS=55
HA_RESP_TTL_PING=20
HA_LOCK_STALE_SEC=300
HA_SEAL_SLACK=120             # a unit is final this long after it ends
HA_RING_TAIL_ROWS=400

HA_WORK=""
HA_TMPS=""
HA_LOCKS=""
HA_FILES=""
HA_USED=""
HA_NOCACHE=0
HA_PARTIAL=0
HA_NICE=0

ha_init() {
    HA_CELL_DIR="${QM_CELL_HISTORY_DIR:-/usrdata/qmanager/cell_history}"
    HA_PING_DIR="${QM_PING_HISTORY_DIR:-/usrdata/qmanager/ping_history}"
    HA_BOOT_LOG="${QM_BOOT_LOG:-/usrdata/qmanager/boot_log.jsonl}"
    HA_CACHE_DIR="${QM_HIST_CACHE_DIR:-/tmp/qmanager_hist_cache}"
    HA_STATE_FILE="${QM_CELL_STATE_FILE:-/tmp/qmanager_cell_history_state}"
    HA_RING_FILE="${QM_PING_RING_FILE:-/tmp/qmanager_ping_history.json}"
    HA_NOW=$(ha_now)
    HA_T0=$(date +%s)
    HA_BUDGET="${QM_HIST_BUILD_BUDGET:-12}"
    case "$HA_BUDGET" in ''|*[!0-9]*) HA_BUDGET=12 ;; esac
    case "${QM_HIST_CACHE_CAP_KB:-}" in
        ''|*[!0-9]*|0) ;;
        *) HA_CACHE_CAP_KB="$QM_HIST_CACHE_CAP_KB" ;;
    esac
}

ha_now() {
    local n
    n="${QM_NOW:-}"
    case "$n" in
        ''|*[!0-9]*) n=$(date +%s) ;;
    esac
    case "$n" in
        ''|*[!0-9]*) n=0 ;;
    esac
    printf '%s' "$n"
}

# ---------------------------------------------------------------------------
# Cleanup. The only things a request can leave behind are its own work dir, a
# half-written cache file and a cache lock; the trap removes all three.
# ---------------------------------------------------------------------------
ha_cleanup() {
    local t
    for t in $HA_TMPS; do
        rm -f "$t" 2>/dev/null
    done
    for t in $HA_LOCKS; do
        rmdir "$t" 2>/dev/null
    done
    [ -n "$HA_WORK" ] && rm -rf "$HA_WORK" 2>/dev/null
    HA_TMPS=""
    HA_LOCKS=""
    HA_WORK=""
}

ha_trap_install() {
    trap 'ha_cleanup' EXIT
    trap 'ha_cleanup; exit 1' INT TERM
}

# Work dirs a SIGKILLed CGI or builder never got to remove (the EXIT trap does not
# run on KILL). A request work dir w.<pid> goes when its pid is gone or it is older
# than HA_WORK_MAX_AGE (pid reuse). A builder dir wb.<pid> carries the pid of the
# CGI that SPAWNED the builder ($$ inside a subshell), which exits at once, so
# liveness cannot be read from the name: the builder holds bg.lock for its whole
# life, so wb.* goes when no bg.lock exists or the dir is older than the same age.
ha_sweep_orphans() {
    local d
    local nm
    local pid
    local m
    local now
    local bg
    now=$(date +%s)
    bg=0
    [ -d "$HA_CACHE_DIR/bg.lock" ] && bg=1
    for d in "$HA_CACHE_DIR"/w.* "$HA_CACHE_DIR"/wb.*; do
        [ -d "$d" ] || continue
        [ -L "$d" ] && continue
        nm="${d##*/}"
        case "$nm" in
            w.*)  pid="${nm#w.}" ;;
            wb.*) pid="${nm#wb.}" ;;
            *) continue ;;
        esac
        case "$pid" in ''|*[!0-9]*) continue ;; esac
        [ "$nm" = "w.$$" ] && continue
        m=$(ha_mtime "$d")
        if [ -n "$m" ] && [ $((now - m)) -gt "$HA_WORK_MAX_AGE" ]; then
            rm -rf "$d" 2>/dev/null
            continue
        fi
        case "$nm" in
            w.*)  [ -d "/proc/$pid" ] || rm -rf "$d" 2>/dev/null ;;
            wb.*) [ "$bg" = "1" ] || rm -rf "$d" 2>/dev/null ;;
        esac
    done
}

# Cache dir + per-request work dir. A cache dir we cannot create (or that is a
# symlink) disables caching but never the request.
ha_setup_dirs() {
    HA_NOCACHE=0
    if [ -L "$HA_CACHE_DIR" ]; then
        HA_NOCACHE=1
    elif [ ! -d "$HA_CACHE_DIR" ]; then
        mkdir -p "$HA_CACHE_DIR" 2>/dev/null || HA_NOCACHE=1
    fi
    [ "$HA_NOCACHE" = "0" ] && ha_sweep_orphans
    if [ "$HA_NOCACHE" = "0" ]; then
        HA_WORK="$HA_CACHE_DIR/w.$$"
    else
        HA_WORK="/tmp/qm_hist_w.$$"
    fi
    mkdir -p "$HA_WORK" 2>/dev/null || { HA_WORK=""; return 1; }
    return 0
}

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

# range -> "<span seconds> <series bucket seconds>"
ha_cells_params() {
    case "$1" in
        1h)  printf '%s %s' 3600 60 ;;
        3h)  printf '%s %s' 10800 60 ;;
        6h)  printf '%s %s' 21600 120 ;;
        12h) printf '%s %s' 43200 300 ;;
        24h) printf '%s %s' 86400 300 ;;
        7d)  printf '%s %s' 604800 1800 ;;
        30d) printf '%s %s' 2592000 7200 ;;
        *) return 1 ;;
    esac
}

ha_ping_params() {
    case "$1" in
        1h)  printf '%s %s' 3600 60 ;;
        6h)  printf '%s %s' 21600 60 ;;
        24h) printf '%s %s' 86400 300 ;;
        7d)  printf '%s %s' 604800 1800 ;;
        *) return 1 ;;
    esac
}

# Device UTC offset in minutes from `date +%z` (+0500 -> 300, -0600 -> -360).
ha_offset_min() {
    local z
    local sign
    local hh
    local mm
    z=$(date +%z 2>/dev/null)
    case "$z" in
        [+-][0-9][0-9][0-9][0-9]) ;;
        *) printf '0'; return 0 ;;
    esac
    sign=1
    case "$z" in -*) sign=-1 ;; esac
    z="${z#?}"
    hh="${z%??}"
    mm="${z#??}"
    # strip a leading zero so ash arithmetic never reads it as octal
    hh="${hh#0}"
    mm="${mm#0}"
    [ -n "$hh" ] || hh=0
    [ -n "$mm" ] || mm=0
    printf '%s' $(( sign * (hh * 60 + mm) ))
}

# A plain or gzipped archive file on stdout.
ha_stream() {
    case "$1" in
        *.gz) gzip -dc "$1" 2>/dev/null ;;
        *) cat "$1" 2>/dev/null ;;
    esac
}

# Directory summary: "<bytes> <count> <oldest name> <newest name>" over files
# named YYYY-MM-DD.jsonl[.gz] (partial .tmp files never match). When a day is
# present both ways (compression in flight) the .gz wins.
ha_dir_summary() {
    ls -ln "$1" 2>/dev/null | awk '
        $1 ~ /^-/ {
            nm = $NF
            if (nm !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][.]jsonl([.]gz)?$/) next
            bytes += $5; cnt++
            day = substr(nm, 1, 10)
            if (substr(nm, 11) == ".jsonl.gz") gz[day] = 1
            seen[day] = 1
        }
        END {
            for (d in seen) {
                sfx = (d in gz) ? ".jsonl.gz" : ".jsonl"
                nm = d sfx
                if (oldest == "" || d < od) { oldest = nm; od = d }
                if (newest == "" || d > nd) { newest = nm; nd = d }
            }
            printf "%.0f %d %s %s\n", bytes, cnt, (oldest == "" ? "-" : oldest), (newest == "" ? "-" : newest)
        }'
}

# mtime in epoch seconds, empty when unreadable.
ha_mtime() {
    local m
    m=$(date -r "$1" +%s 2>/dev/null)
    case "$m" in
        ''|*[!0-9]*) m="" ;;
    esac
    printf '%s' "$m"
}

# Is response-cache file $1 younger than $2 seconds AND no older than file $3?
ha_resp_fresh() {
    local m
    local r
    local s
    [ -f "$1" ] || return 1
    m=$(ha_mtime "$1")
    [ -n "$m" ] || return 1
    r=$(date +%s)
    [ $((r - m)) -lt "$2" ] || return 1
    [ $((m - r)) -lt 5 ] || return 1
    if [ -n "$3" ] && [ -f "$3" ]; then
        s=$(ha_mtime "$3")
        [ -n "$s" ] && [ "$m" -lt "$s" ] && return 1
    fi
    return 0
}

# Eviction pass, two rules:
#  1. Response files (resp_*, cells and ping) older than HA_RESP_MAX_AGE are
#     deleted. They are served for under a minute, so an old one is dead weight.
#  2. The reduced BLOCKS are capped at HA_CACHE_CAP_KB: newest kept, oldest deleted,
#     never a file named in $HA_USED (this request's inputs). resp_* files are NOT
#     counted: a handful of 100 KB responses (one per range and panel set) used to
#     eat the cap and evict every block on a range switch, so the next request had
#     to rebuild them.
ha_evict() {
    local victims
    local f
    local m
    local now
    [ "$HA_NOCACHE" = "0" ] || return 0
    now=$(date +%s)
    for f in "$HA_CACHE_DIR"/resp_*; do
        [ -f "$f" ] || continue
        m=$(ha_mtime "$f")
        if [ -z "$m" ] || [ $((now - m)) -gt "$HA_RESP_MAX_AGE" ]; then
            rm -f "$f" 2>/dev/null
        fi
    done
    victims=$(ls -lnt "$HA_CACHE_DIR" 2>/dev/null | awk -v cap="$((HA_CACHE_CAP_KB * 1024))" -v used=" $HA_USED " '
        $1 ~ /^-/ {
            if ($NF ~ /^resp_/) next
            sum += $5
            if (sum > cap && index(used, " " $NF " ") == 0) print $NF
        }')
    for f in $victims; do
        rm -f "$HA_CACHE_DIR/$f" 2>/dev/null
    done
}

# ---------------------------------------------------------------------------
# Restarts: boot_log.jsonl lines inside [start, end], oldest first.
# ---------------------------------------------------------------------------
ha_restarts_json() {
    [ -f "$HA_BOOT_LOG" ] || { printf '[]'; return 0; }
    awk -v st="$1" -v en="$2" '
    function nn(v) { return (v ~ /^[0-9]+$/) ? v : "null" }
    BEGIN { printf "["; first = 1 }
    {
        p = $0
        if (substr(p, 1, 1) != "{" || substr(p, length(p)) != "}") next
        gsub(/[{}"]/, "", p)
        n = split(p ",E", f, ",") - 1
        bt = ""; la = ""; ds = ""; ca = ""
        for (i = 1; i <= n; i++) {
            x = index(f[i], ":")
            if (x < 2) continue
            k = substr(f[i], 1, x - 1); v = substr(f[i], x + 1)
            if (k == "boot_ts") bt = v
            else if (k == "last_alive_ts") la = v
            else if (k == "down_sec") ds = v
            else if (k == "cause") ca = v
        }
        if (bt !~ /^[0-9]+$/) next
        if (bt + 0 < st + 0 || bt + 0 > en + 0) next
        if (ca != "power_loss" && ca != "restart" && ca != "planned") ca = "unknown"
        sep = first ? "" : ","
        printf "%s{\"boot_ts\":%s,\"last_alive_ts\":%s,\"down_sec\":%s,\"cause\":\"%s\"}", sep, bt, nn(la), nn(ds), ca
        first = 0
    }
    END { printf "]" }' "$HA_BOOT_LOG"
}

# ---------------------------------------------------------------------------
# AWK PROGRAMS
# ---------------------------------------------------------------------------
# No single quote may appear inside any program: they live in shell '' strings.
# BusyBox awk reads `name (` as a function call - never put a space between an
# identifier and a parenthesis that is meant as grouping after concatenation.

# Piece planner. Prints "<kind> <start> <end> <day idx> <YYYY-MM-DD> <offset>"
# for kind D (a closed day inside the window), H (a sealed unit), L (live edge).
# unit = 3600 s, or the bucket when that is larger; every bucket divides it.
HA_AWK_PLAN='
function dayname(d,   z, era, doe, yoe, y, doy, mp, dd, m) {
    z = d + 719468; era = int(z / 146097); doe = z - era * 146097
    yoe = int((doe - int(doe / 1460) + int(doe / 36524) - int(doe / 146096)) / 365)
    y = yoe + era * 400
    doy = doe - (365 * yoe + int(yoe / 4) - int(yoe / 100))
    mp = int((5 * doy + 2) / 153)
    dd = doy - int((153 * mp + 2) / 5) + 1
    m = (mp < 10) ? mp + 3 : mp - 9
    if (m <= 2) y++
    return sprintf("%04d-%02d-%02d", y, m, dd)
}
function emit(kind, s, e,   d) {
    d = int(s / 86400)
    printf "%s %.0f %.0f %d %s %d\n", kind, s, e, d, dayname(d), s - d * 86400
}
BEGIN {
    U = (bucket + 0 > 3600) ? bucket + 0 : 3600
    st = start + 0; en = end + 0
    seal = int((en - slack) / U) * U
    c = st
    while (c <= en) {
        if (c % 86400 == 0 && c + 86400 <= seal) { emit("D", c, c + 86399); c += 86400 }
        else if (c % U == 0 && c + U <= seal) { emit("H", c, c + U - 1); c += U }
        else {
            nx = (int(c / U) + 1) * U; e = nx - 1
            if (e > en) e = en
            emit("L", c, e); c = nx
        }
    }
}
'

# Cell reducer: one archive piece -> tagged TSV. Series come out already
# rendered as JSON point lists (X); the row-level state machines emit spans.
#   X id text         m:<panel> | c:<key>:<rsrp|rsrq|sinr|rssi> | b:<B3|N41> |
#                     a:<1..8 antenna port> | g (congestion) | v (availability)
#   Y port dbm n      histogram of per-bucket antenna means (for the median)
#   O start end n head open   NR outage span (head: no 1 before it; open: ran to EOF)
#   T start end n lpci lband nband known up   serving-cell run
#   B start end n bands ca_s ca_n bw_s bw_n   band-combo run
#   K bands n first last ca_s ca_n bw_s bw_n  combo rollup
#   S key band cid n down known first last    per-PCI stat
#   D key tech band arfcn bw samples pcc      carrier meta
#   W n first last / V cov_from               window counts, identity coverage
#   F ts f1..f12 / E ts field from to / L ts f1..f12   events and boundary state
# With -v snap=1 it instead prints one Z line: the LAST valid row's identity
# (snap=2: the FIRST valid row's), for the snapshot and the oldest timestamp.
#
# Cost control: a row is split once, positionally; the carrier layout is compared
# as ONE string against the previous row's and everything derived from it (PCC,
# identity, band combo, keys) is only recomputed when it changes; per-PCI stats
# and combo rollups accumulate per RUN, not per row.
HA_AWK_CELL='
function nm(x) { return (x == int(x)) ? sprintf("%.0f", x) : sprintf("%.2f", x) }
function fm(v,   x) {
    if (v >= 100000 || v <= -100000) return sprintf("%.0f", v)
    x = (v < 0) ? -int(-v * 10 + 0.5) : int(v * 10 + 0.5)
    if (x == 0) return "0"
    return x / 10
}
function ssafe(s) { return (s ~ /^[A-Za-z0-9_.+-]*$/) ? s : "" }
function bnum(s) { return (s ~ /^[BN][0-9]+$/) ? substr(s, 2) : "" }

function flush(   i, m, j, key, k, tk, kp, v, dl, sat, pfx, bsx) {
    if (curb < 0) return
    bsx = sprintf("%.0f", curb)
    pfx = "{\"ts\":" bsx ",\"v\":"
    for (i = 1; i <= 23; i++) {
        m = MAP[i]
        if (bn[m] > 0) OT[PN[i]] = OT[PN[i]] pfx fm(bs[m] / bn[m]) "},"
    }
    for (key in ckeys) {
        for (j = 1; j <= 4; j++) {
            k = key "|" j
            if (CN[k] > 0) OT["c:" key ":" CJ[j]] = OT["c:" key ":" CJ[j]] pfx fm(CS[k] / CN[k]) "},"
        }
        k = key "|1"
        if (CN[k] > 0) {
            split(key, kp, ":")
            tk = (kp[1] == "L" ? "B" : "N") kp[2]
            TSs[tk] += CS[k]; TNs[tk] += CN[k]
        }
    }
    for (tk in TSs) OT["b:" tk] = OT["b:" tk] pfx fm(TSs[tk] / TNs[tk]) "},"
    for (j = 1; j <= 8; j++) {
        if (AN[j] > 0) {
            v = AS[j] / AN[j]
            OT["a:" j] = OT["a:" j] pfx fm(v) "},"
            HCb[j "|" int(v < 0 ? v - 0.5 : v + 0.5)]++
        }
    }
    if (gw > 0 || gdn > 0) {
        dl = (gdn > 0) ? gdl / gdn : ""
        sat = (dl != "" && dl + 0 >= 20000000 && gw >= 3) ? "true" : "false"
        OT["g"] = OT["g"] "{\"ts\":" bsx ",\"prb_share\":" (gw > 0 ? fm(gsum / gw) : "null") ",\"prb_max_share\":" (gmax != "" ? fm(gmax) : "null") ",\"dl_bps\":" (dl == "" ? "null" : sprintf("%.0f", dl)) ",\"saturated\":" sat ",\"samples\":" sprintf("%.0f", gw) "},"
    }
    delete bs; delete bn; delete CS; delete CN; delete ckeys; delete AS; delete AN; delete TSs; delete TNs
    gsum = 0; gw = 0; gmax = ""; gdl = 0; gdn = 0
}
function close_out(open) {
    if (in_out) printf "O\t%.0f\t%.0f\t%d\t%d\t%d\n", out_start, out_end, out_n, out_head, open
    in_out = 0; out_n = 0
}
function close_run(   k) {
    if (run_n > 0) {
        printf "T\t%.0f\t%.0f\t%d\t%s\t%s\t%s\t%d\t%d\n", run_start, run_end, run_n, run_lpci, run_lband, run_nband, run_known, run_up
        k = run_ck
        if (!(k in Sn)) { Sband[k] = run_lband; Scid[k] = run_cid; Sfirst[k] = run_start }
        if (Scid[k] == "" && run_cid != "") Scid[k] = run_cid
        if (Sband[k] == "" && run_lband != "") Sband[k] = run_lband
        Sn[k] += run_n; Slast[k] = run_end
        Sknown[k] += run_known; Sdown[k] += run_known - run_up
    }
    run_n = 0; run_known = 0; run_up = 0
}
function close_band() {
    if (bn_n > 0) {
        printf "B\t%.0f\t%.0f\t%d\t%s\t%s\t%s\t%s\t%s\n", b_start, b_end, bn_n, b_key, nm(b_cas), b_can, nm(b_bws), b_bwn
        if (b_key != "") {
            if (!(b_key in Kn)) Kfirst[b_key] = b_start
            Kn[b_key] += bn_n; Klast[b_key] = b_end
            Kcas[b_key] += b_cas; Kcan[b_key] += b_can; Kbws[b_key] += b_bws; Kbwn[b_key] += b_bwn
        }
    }
    bn_n = 0; b_cas = 0; b_can = 0; b_bws = 0; b_bwn = 0
}
function sigflush(   c) {
    if (sigrows > 0)
        for (c = 1; c <= NCs; c++)
            if (ckey[c] != "") { Dn[ckey[c]] += sigrows; if (crole[c] == "P") Dp[ckey[c]] += sigrows }
    sigrows = 0
}

BEGIN {
    gap = gap_sec + 0; if (gap <= 0) gap = 180
    bk = bucket + 0; if (bk <= 0) bk = 300
    ab = avail + 0; if (ab <= 0) ab = bk
    st = start + 0; en = end + 0
    NEV = split("nr_avail lte_pci lte_band lte_earfcn lte_bw nr_pci nr_band nr_arfcn lte_cellid nr_cellid network_type bands", EVN, " ")
    split("ts rat lte_pci lte_band lte_earfcn lte_bw lte_cell_id lte_tac nr_pci nr_band nr_arfcn nr_cell_id nr_tac nr_avail rsrp rsrq sinr", V1K, " ")
    split("31 32 33 34 35 36 37 15 18 16 19 13 20 38 14 28 29 30 26 27 39 12 40", MAP, " ")
    split("rsrp sinr rsrq rssi cqi rank mcs lte_mcs nr_mcs lte_ri nr_ri lte_cqi nr_cqi ul_mcs tx_power temp cpu mem dl ul ca bw total_cells", PNm, " ")
    for (i = 1; i <= 23; i++) PN[i] = "m:" PNm[i]
    split("rsrp rsrq sinr rssi", CJ, " ")
    for (i = 1; i <= 40; i++) OFF[i] = 38 + (i - 1) * 10
    curb = -1; in_out = 0; out_n = 0; run_n = 0; bn_n = 0; NW = 0; had_prev = 0; seen_up = 0; ne = 0; gmax = ""
    lastsig = ""; sigrows = 0; NCs = 0
}

{
    s = $0
    if (substr(s, 1, 3) == "[2,") {
        i = index(substr(s, 4, 12), ","); if (i < 2) next
        T = substr(s, 4, i - 1) + 0
        if (T <= 0 || T < st || T > en) next
        L = length(s)
        if (substr(s, L) != "]") next
        p = s
        gsub(/[]["]|null/, "", p)
        n = split(p ",E", f, ",") - 1
        if (n < 38 || (n - 38) % 10 != 0 || n > 398) next
        NC = (n - 38) / 10
        if (NC > 0) { if (substr(s, L - 1) != "]]") next }
        else if (substr(s, L - 1) == "]]") next
        if (f[2] + 0 != T) next
        v1row = 0
    } else if (substr(s, 1, 6) == "{\"ts\":") {
        i = index(substr(s, 7, 12), ","); if (i < 2) next
        T = substr(s, 7, i - 1) + 0
        if (T <= 0 || T < st || T > en) next
        L = length(s)
        if (substr(s, L) != "}") next
        p = s
        gsub(/[{}"]/, "", p)
        n = split(p ",E", f, ",") - 1
        if (n != 17) next
        bad = 0
        for (i = 1; i <= 17; i++) {
            idx = index(f[i], ":")
            if (substr(f[i], 1, idx - 1) != V1K[i]) { bad = 1; break }
            g[i] = substr(f[i], idx + 1)
            if (g[i] == "null") g[i] = ""
        }
        if (bad) next
        # re-lay the v1 row out as a v2 row: head columns + synthetic carriers
        # (v1 rows have no carrier count, so they never feed `ca` / combo ca_cc)
        v1row = 1
        for (i = 1; i <= 80; i++) f[i] = ""
        nt_ = ssafe(g[2])
        f[3] = (nt_ == "5G-NSA") ? "NSA" : (nt_ == "5G-SA") ? "SA" : nt_
        f[4] = g[14]; f[6] = g[7]; f[7] = g[8]; f[8] = g[12]; f[9] = g[13]
        NC = 0
        lt = (g[3] != "" || g[4] != "")
        nt = (g[9] != "" || g[10] != "")
        if (lt) {
            NC++; o = OFF[NC]
            f[o + 1] = "P"; f[o + 2] = "L"; f[o + 3] = bnum(ssafe(g[4])); f[o + 4] = g[5]; f[o + 5] = g[6]; f[o + 6] = g[3]
            f[o + 7] = g[15]; f[o + 8] = g[16]; f[o + 9] = g[17]
        }
        if (nt) {
            NC++; o = OFF[NC]
            f[o + 1] = (lt ? "S" : "P"); f[o + 2] = "N"; f[o + 3] = bnum(ssafe(g[10])); f[o + 4] = g[11]; f[o + 6] = g[9]
            if (!lt) { f[o + 7] = g[15]; f[o + 8] = g[16]; f[o + 9] = g[17] }
        }
    } else next

    # ---- carrier layout: recompute derived identity only when it changes -----
    sig = ""
    for (c = 1; c <= NC; c++) { o = OFF[c]; sig = sig f[o + 1] f[o + 2] f[o + 3] "," f[o + 4] "," f[o + 5] "," f[o + 6] ";" }
    if (sig != lastsig) {
        sigflush()
        pc = 0; li = 0; ni = 0; ok = 1
        for (c = 1; c <= NC; c++) {
            o = OFF[c]; r_ = f[o + 1]; t_ = f[o + 2]
            if ((r_ != "P" && r_ != "S") || (t_ != "L" && t_ != "N")) { ok = 0; break }
            if (!pc && r_ == "P") pc = c
            if (!li && t_ == "L") li = c
            if (!ni && t_ == "N") ni = c
        }
        if (!ok) { lastsig = ""; next }
        NCs = NC
        for (c = 1; c <= NC; c++) {
            o = OFF[c]; t_ = f[o + 2]; b_ = f[o + 3]; a_ = f[o + 4]
            crole[c] = f[o + 1]
            if (b_ == "" || a_ == "") ckey[c] = ""
            else {
                key = t_ ":" b_ ":" a_
                ckey[c] = key; c1[c] = key "|1"; c2[c] = key "|2"; c3[c] = key "|3"; c4[c] = key "|4"
                if (!(key in Dt)) { Dt[key] = t_; Db[key] = b_; Da[key] = a_ }
                if (f[o + 5] != "") Dw[key] = f[o + 5]
            }
        }
        if (li) { o = OFF[li]; lpci = f[o + 6]; lband = (f[o + 3] != "" ? "B" f[o + 3] : ""); learfcn = f[o + 4]; lbw = f[o + 5] }
        else { lpci = ""; lband = ""; learfcn = ""; lbw = "" }
        if (ni) { o = OFF[ni]; npci = f[o + 6]; nband = (f[o + 3] != "" ? "N" f[o + 3] : ""); narfcn = f[o + 4]; nbw = f[o + 5] }
        else { npci = ""; nband = ""; narfcn = ""; nbw = "" }
        # canonical band-combo string: PCC first, then LTE before NR, ascending
        # band; duplicates (two carriers of one band) collapse.
        nt_ = 0
        for (c = 1; c <= NC; c++) {
            o = OFF[c]
            if (c == pc || f[o + 3] == "") continue
            nt_++; RK[nt_] = (f[o + 2] == "L" ? 0 : 1000) + f[o + 3]
            TK[nt_] = (f[o + 2] == "L" ? "B" : "N") f[o + 3]
        }
        for (i = 2; i <= nt_; i++) {
            kr = RK[i]; kt = TK[i]; j = i - 1
            while (j >= 1 && RK[j] > kr) { RK[j + 1] = RK[j]; TK[j + 1] = TK[j]; j-- }
            RK[j + 1] = kr; TK[j + 1] = kt
        }
        bands = ""
        if (pc && f[OFF[pc] + 3] != "") bands = (f[OFF[pc] + 2] == "L" ? "B" : "N") f[OFF[pc] + 3]
        for (i = 1; i <= nt_; i++) {
            if (bands == "") bands = TK[i]
            else if (index("+" bands "+", "+" TK[i] "+") == 0) bands = bands "+" TK[i]
        }
        poff = pc ? OFF[pc] : 0
        PT = pc ? f[poff + 2] : ""
        cur = lpci "|" lband "|" nband
        lastsig = sig
    }
    sigrows++

    nav = f[4]; if (nav != "0" && nav != "1") nav = ""
    RAT = f[3]

    if (snap) {
        zl = "Z\t" sprintf("%.0f", T) "\t" lpci "\t" learfcn "\t" lband "\t" lbw "\t" f[6] "\t" f[7] "\t" npci "\t" narfcn "\t" nband "\t" nbw "\t" f[8] "\t" f[9] "\t" ((RAT == "NSA") ? "5G-NSA" : (RAT == "SA") ? "5G-SA" : RAT) "\t" nav
        if (snap == 2) exit
        next
    }

    b = int(T / bk) * bk
    if (b != curb) { flush(); curb = b }

    # ---- series metrics (raw columns 12..30 land under their own index) ------
    for (i = 12; i <= 21; i++) { v = f[i]; if (v != "") { bs[i] += v; bn[i]++ } }
    for (i = 26; i <= 30; i++) { v = f[i]; if (v != "") { bs[i] += v; bn[i]++ } }
    if (poff) {
        v = f[poff + 7]; if (v != "") { bs[31] += v; bn[31]++ }
        v = f[poff + 9]; if (v != "") { bs[32] += v; bn[32]++ }
        v = f[poff + 8]; if (v != "") { bs[33] += v; bn[33]++ }
        v = f[poff + 10]; if (v != "") { bs[34] += v; bn[34]++ }
    }
    if (PT == "N" || (PT == "" && RAT == "SA")) { v = f[20]; w = f[19]; x = f[18]; u = f[21] }
    else { v = f[13]; w = f[16]; x = f[15]; u = f[17] }
    if (v != "") { bs[35] += v; bn[35]++ }
    if (w != "") { bs[36] += w; bn[36]++ }
    if (x != "") { bs[37] += x; bn[37]++ }
    if (RAT == "SA") u = f[21]
    else if (RAT == "NSA") { if (f[21] != "") u = f[21] }
    if (u != "") { bs[38] += u; bn[38]++ }
    if (NC > 0 && !v1row) { bs[39] += NC; bn[39]++ }
    if (f[10] != "" || f[11] != "") { bs[40] += f[10] + f[11] + 1; bn[40]++ }

    for (c = 1; c <= NC; c++) {
        if (ckey[c] == "") continue
        o = OFF[c]
        v = f[o + 7]; if (v != "") { CS[c1[c]] += v; CN[c1[c]]++ }
        v = f[o + 8]; if (v != "") { CS[c2[c]] += v; CN[c2[c]]++ }
        v = f[o + 9]; if (v != "") { CS[c3[c]] += v; CN[c3[c]]++ }
        v = f[o + 10]; if (v != "") { CS[c4[c]] += v; CN[c4[c]]++ }
        ckeys[ckey[c]] = 1
    }
    for (j = 1; j <= 8; j++) { v = f[30 + j]; if (v != "") { AS[j] += v; AN[j]++ } }
    if (f[22] != "" && f[24] != "" && f[25] != "" && f[25] + 0 > 0 && f[24] + 0 > 0) {
        gsum += 100 * f[22] * f[24] / f[25]; gw += f[24]
        if (f[23] != "") { sx = 100 * f[23] / f[25]; if (gmax == "" || sx > gmax) gmax = sx }
    }
    if (f[26] != "") { gdl += f[26]; gdn++ }

    NW++; if (NW == 1) wfirst = T
    wlast = T
    if (covfrom == "" && NC > 0) covfrom = T

    if (nav != "") { k = int(T / ab) * ab; An[k]++; if (nav == "1") Au[k]++ }

    # ---- outage spans (nr_avail 0), cut at the gap threshold -----------------
    if (in_out && T - out_end > gap) close_out(0)
    if (nav == "0") {
        if (!in_out) { in_out = 1; out_start = T; out_head = seen_up ? 0 : 1 }
        out_end = T; out_n++
    } else if (nav == "1") {
        seen_up = 1
        if (in_out) close_out(0)
    }

    # ---- serving-cell run ----------------------------------------------------
    if (run_n > 0 && (cur != run_key || T - run_end > gap)) close_run()
    if (run_n == 0) { run_start = T; run_lpci = lpci; run_lband = lband; run_nband = nband; run_key = cur; run_ck = (lpci == "" ? "(none)" : lpci); run_cid = "" }
    run_end = T; run_n++
    if (run_cid == "" && f[6] != "") run_cid = f[6]
    if (nav != "") { run_known++; if (nav == "1") run_up++ }

    # ---- band-combo run ------------------------------------------------------
    if (bn_n > 0 && (bands != b_key || T - b_end > gap)) close_band()
    if (bn_n == 0) { b_start = T; b_key = bands }
    b_end = T; bn_n++
    if (NC > 0 && !v1row) { b_cas += NC; b_can++ }
    if (f[12] != "") { b_bws += f[12]; b_bwn++ }

    # ---- identity events: only when something that feeds them changed --------
    idsig = RAT "|" nav "|" f[6] "|" f[8]
    if (!had_prev || sig != esig || idsig != eidsig) {
        CV[1] = nav; CV[2] = lpci; CV[3] = lband; CV[4] = learfcn; CV[5] = lbw; CV[6] = npci; CV[7] = nband
        CV[8] = narfcn; CV[9] = f[6]; CV[10] = f[8]; CV[11] = (RAT == "NSA") ? "5G-NSA" : (RAT == "SA") ? "5G-SA" : RAT; CV[12] = bands
        if (!had_prev) {
            fline = "F\t" sprintf("%.0f", T)
            for (i = 1; i <= NEV; i++) fline = fline "\t" CV[i]
        } else {
            for (i = 1; i <= NEV; i++)
                if (CV[i] != PV[i]) { ne++; EVB[ne] = "E\t" sprintf("%.0f", T) "\t" EVN[i] "\t" PV[i] "\t" CV[i] }
        }
        for (i = 1; i <= NEV; i++) PV[i] = CV[i]
        esig = sig; eidsig = idsig
    }
    had_prev = 1; lastts = T
}

END {
    if (snap) { if (zl != "") print zl; exit }
    sigflush()
    flush()
    close_out(1); close_run(); close_band()
    printf "W\t%d\t%s\t%s\n", NW, (NW > 0 ? sprintf("%.0f", wfirst) : ""), (NW > 0 ? sprintf("%.0f", wlast) : "")
    printf "V\t%s\n", (covfrom == "" ? "" : sprintf("%.0f", covfrom))
    if (NW > 0)
        for (k = int(wfirst / ab) * ab; k <= wlast; k += ab)
            if (An[k] > 0) OT["v"] = OT["v"] "{\"ts\":" sprintf("%.0f", k) ",\"n\":" An[k] ",\"up\":" (Au[k] + 0) "},"
    for (id in OT) printf "X\t%s\t%s\n", id, substr(OT[id], 1, length(OT[id]) - 1)
    for (k in HCb) { split(k, hp, "|"); printf "Y\t%s\t%s\t%d\n", hp[1], hp[2], HCb[k] }
    for (k in Sn) printf "S\t%s\t%s\t%s\t%d\t%d\t%d\t%.0f\t%.0f\n", k, Sband[k], Scid[k], Sn[k], Sdown[k], Sknown[k], Sfirst[k], Slast[k]
    for (k in Kn) printf "K\t%s\t%d\t%.0f\t%.0f\t%s\t%d\t%s\t%d\n", k, Kn[k], Kfirst[k], Klast[k], nm(Kcas[k]), Kcan[k], nm(Kbws[k]), Kbwn[k]
    for (k in Dn) printf "D\t%s\t%s\t%s\t%s\t%s\t%d\t%d\n", k, Dt[k], Db[k], Da[k], Dw[k], Dn[k], Dp[k]
    if (had_prev) {
        print fline
        for (i = 1; i <= ne; i++) print EVB[i]
        lline = "L\t" sprintf("%.0f", lastts)
        for (i = 1; i <= NEV; i++) lline = lline "\t" PV[i]
        print lline
    }
}
'

# Ping reducer. Archive rows `[ts,n,ok,avg,min,max,jit,loss]` (a row with n=0
# carries nothing) and tmpfs ring rows `{"ts":..,"lat":..,"jit":..}` (one 10 s
# probe each; only ring rows newer than -v cut are used) -> rendered series:
#   X p:lat|p:jit|p:loss  {ts,v} point lists (cells view)
#   X p:pts               PingHistoryPoint objects (ping view)
HA_AWK_PING='
function fm(v,   x) {
    if (v >= 100000 || v <= -100000) return sprintf("%.0f", v)
    x = (v < 0) ? -int(-v * 10 + 0.5) : int(v * 10 + 0.5)
    if (x == 0) return "0"
    return x / 10
}
function flush(   bsx, pfx, loss, avg, jit) {
    if (curb >= 0 && pn > 0) {
        bsx = sprintf("%.0f", curb)
        pfx = "{\"ts\":" bsx ",\"v\":"
        avg = (pokw > 0) ? fm(pavgw / pokw) : "null"
        jit = (pjn > 0) ? fm(pjs / pjn) : "null"
        loss = fm(100 * (pn - pok) / pn)
        if (pokw > 0) OT["p:lat"] = OT["p:lat"] pfx avg "},"
        if (pjn > 0) OT["p:jit"] = OT["p:jit"] pfx jit "},"
        OT["p:loss"] = OT["p:loss"] pfx loss "},"
        OT["p:pts"] = OT["p:pts"] "{\"ts\":" bsx ",\"n\":" sprintf("%.0f", pn) ",\"ok\":" sprintf("%.0f", pok) ",\"avg\":" avg ",\"min\":" (pmin != "" ? fm(pmin) : "null") ",\"max\":" (pmax != "" ? fm(pmax) : "null") ",\"jit\":" jit ",\"loss\":" loss "},"
    }
    pn = 0; pok = 0; pavgw = 0; pokw = 0; pmin = ""; pmax = ""; pjs = 0; pjn = 0
}
function add(T, n, ok, avg, mn, mx, jit,   b) {
    b = int(T / bk) * bk
    if (b != curb) { flush(); curb = b }
    pn += n; pok += ok
    if (avg != "" && ok > 0) { pavgw += avg * ok; pokw += ok }
    if (mn != "" && (pmin == "" || mn + 0 < pmin + 0)) pmin = mn
    if (mx != "" && (pmax == "" || mx + 0 > pmax + 0)) pmax = mx
    if (jit != "") { pjs += jit; pjn++ }
}
BEGIN { bk = bucket + 0; if (bk <= 0) bk = 60; st = start + 0; en = end + 0; cutv = cut + 0; curb = -1; pmin = ""; pmax = "" }
{
    s = $0; L = length(s)
    c1 = substr(s, 1, 1)
    if (c1 == "[") {
        if (substr(s, L) != "]") next
        p = s
        gsub(/[]["]|null/, "", p)
        n = split(p ",E", f, ",") - 1
        if (n != 8 || f[1] !~ /^[0-9]+$/ || f[2] !~ /^[0-9]+$/ || f[3] !~ /^[0-9]+$/) next
        T = f[1] + 0
        if (T < st || T > en) next
        if (f[3] + 0 > f[2] + 0 || f[2] + 0 <= 0) next
        add(T, f[2] + 0, f[3] + 0, f[4], f[5], f[6], f[7])
    } else if (c1 == "{") {
        if (substr(s, L) != "}") next
        p = s
        gsub(/[{}"]/, "", p)
        n = split(p ",E", f, ",") - 1
        T = 0; lat = ""; jit = ""
        for (i = 1; i <= n; i++) {
            x = index(f[i], ":")
            if (x < 2) continue
            k = substr(f[i], 1, x - 1); v = substr(f[i], x + 1)
            if (v == "null") v = ""
            if (k == "ts") T = v + 0
            else if (k == "lat") lat = v
            else if (k == "jit") jit = v
        }
        if (T <= 0 || T < st || T > en || T <= cutv) next
        add(T, 1, (lat != "" ? 1 : 0), lat, lat, lat, jit)
    }
}
END {
    flush()
    for (id in OT) printf "X\t%s\t%s\n", id, substr(OT[id], 1, length(OT[id]) - 1)
}
'

# Ping merge -> PingHistoryRanged JSON.
HA_AWK_PINGMERGE='
BEGIN { FS = "\t" }
$1 == "X" && $2 == "p:pts" { pts = (pts == "") ? $3 : pts "," $3 }
END {
    printf "{\"success\":true,\"range\":\"%s\",\"bucket_sec\":%s,\"generated_at\":%s,\"window\":{\"start\":%s,\"end\":%s},\"points\":[%s],\"restarts\":%s,\"device_utc_offset_min\":%s}\n", range, bucket, gen, start, end, pts, restarts, offset
}
'

# Cells merge: every piece's TSV (in order) -> the CellHistorySuccess JSON.
HA_AWK_MERGE='
function fmt(v,   r) {
    if (v >= 100000 || v <= -100000) return sprintf("%.0f", v)
    r = sprintf("%.1f", v); sub(/[.]0$/, "", r)
    if (r == "-0") r = "0"
    return r
}
function jn(v) { return (v == "") ? "null" : fmt(v) }
function js(v) { return (v == "") ? "null" : "\"" v "\"" }
function ji(v) { return (v == "") ? "null" : sprintf("%.0f", v) }

# ORD[1..n] <- indices sorted by SK[] (stable)
function sort_desc(n,   i, j, t) {
    for (i = 1; i <= n; i++) ORD[i] = i
    for (i = 2; i <= n; i++) {
        t = ORD[i]; j = i - 1
        while (j >= 1 && SK[ORD[j]] < SK[t]) { ORD[j + 1] = ORD[j]; j-- }
        ORD[j + 1] = t
    }
}
function sort_asc(n,   i, j, t) {
    for (i = 1; i <= n; i++) ORD[i] = i
    for (i = 2; i <= n; i++) {
        t = ORD[i]; j = i - 1
        while (j >= 1 && SK[ORD[j]] > SK[t]) { ORD[j + 1] = ORD[j]; j-- }
        ORD[j + 1] = t
    }
}
# median of the per-bucket mean RSRP (rounded to dBm) of antenna port $1
function median(port,   v, tot, cum, lo, hi, mid1, mid2) {
    tot = 0
    for (v = -300; v <= 100; v++) tot += HC[port "|" v]
    if (tot == 0) return ""
    mid1 = int((tot + 1) / 2); mid2 = int(tot / 2) + 1
    cum = 0; lo = ""; hi = ""
    for (v = -300; v <= 100; v++) {
        cum += HC[port "|" v]
        if (lo == "" && cum >= mid1) lo = v
        if (hi == "" && cum >= mid2) { hi = v; break }
    }
    return (lo + hi) / 2
}

BEGIN {
    FS = "\t"
    gap = gap_sec + 0; if (gap <= 0) gap = 180
    bk = bucket + 0; ab = avail + 0; st = start + 0; en = end + 0
    NEV = split("nr_avail lte_pci lte_band lte_earfcn lte_bw nr_pci nr_band nr_arfcn lte_cellid nr_cellid network_type bands", EVN, " ")
    NP = split(panels, PAN, " ")
    no = 0; nt = 0; nb = 0; ng = 0; havel = 0; nw = 0; wfirst = ""; wlast = ""; cov = ""
}

$1 == "X" {
    if (OUT[$2] == "") OUT[$2] = $3; else OUT[$2] = OUT[$2] "," $3
    if (substr($2, 1, 2) == "b:") BT[substr($2, 3)] = 1
    next
}
$1 == "Y" { HC[$2 "|" $3] += $4; next }
$1 == "W" {
    nw += $2
    if ($3 != "" && (wfirst == "" || $3 + 0 < wfirst + 0)) wfirst = $3 + 0
    if ($4 != "" && (wlast == "" || $4 + 0 > wlast + 0)) wlast = $4 + 0
    next
}
$1 == "V" { if ($2 != "" && (cov == "" || $2 + 0 < cov + 0)) cov = $2 + 0; next }
$1 == "D" {
    key = $2
    if (!(key in DS)) { DT[key] = $3; DB[key] = $4; DA[key] = $5; ndk++; DK[ndk] = key }
    DS[key] += $7; DP[key] += $8
    if ($6 != "") DW[key] = $6
    next
}
$1 == "S" {
    k = $2
    if (!(k in SN)) { SBAND[k] = $3; SCID[k] = $4; SFIRST[k] = $8 + 0; nsk++; SKEY[nsk] = k }
    if (SBAND[k] == "" && $3 != "") SBAND[k] = $3
    if (SCID[k] == "" && $4 != "") SCID[k] = $4
    SN[k] += $5; SDOWN[k] += $6; SKNOWN[k] += $7
    if ($8 + 0 < SFIRST[k]) SFIRST[k] = $8 + 0
    if (!(k in SLAST) || $9 + 0 > SLAST[k]) SLAST[k] = $9 + 0
    next
}
$1 == "K" {
    k = $2
    if (!(k in KN)) { KFIRST[k] = $4 + 0; nkk++; KKEY[nkk] = k }
    KN[k] += $3
    if ($4 + 0 < KFIRST[k]) KFIRST[k] = $4 + 0
    if (!(k in KLAST) || $5 + 0 > KLAST[k]) KLAST[k] = $5 + 0
    KCAS[k] += $6; KCAN[k] += $7; KBWS[k] += $8; KBWN[k] += $9
    next
}
$1 == "O" {
    s0 = $2 + 0; e0 = $3 + 0
    if (no > 0 && OOPEN[no] && $5 == 1 && s0 - OE[no] <= gap) { OE[no] = e0; ON[no] += $4; OOPEN[no] = $6 }
    else { no++; OS[no] = s0; OE[no] = e0; ON[no] = $4; OOPEN[no] = $6 }
    next
}
$1 == "T" {
    s0 = $2 + 0; e0 = $3 + 0; key = $5 "|" $6 "|" $7
    if (nt > 0 && TKEY[nt] == key && s0 - TE[nt] <= gap) { TE[nt] = e0; TN[nt] += $4; TKN[nt] += $8; TUP[nt] += $9 }
    else { nt++; TS[nt] = s0; TE[nt] = e0; TN[nt] = $4; TKEY[nt] = key; TLP[nt] = $5; TLB[nt] = $6; TNB[nt] = $7; TKN[nt] = $8; TUP[nt] = $9 }
    next
}
$1 == "B" {
    s0 = $2 + 0; e0 = $3 + 0
    if (nb > 0 && BKEY[nb] == $5 && s0 - BE[nb] <= gap) { BE[nb] = e0; BN[nb] += $4; BCAS[nb] += $6; BCAN[nb] += $7; BBWS[nb] += $8; BBWN[nb] += $9 }
    else { nb++; BS[nb] = s0; BE[nb] = e0; BN[nb] = $4; BKEY[nb] = $5; BCAS[nb] = $6; BCAN[nb] = $7; BBWS[nb] = $8; BBWN[nb] = $9 }
    next
}
$1 == "F" {
    if (havel) {
        txt = ""
        for (i = 1; i <= NEV; i++)
            if ($(i + 2) != PL[i]) { sep = (txt == "") ? "" : ","; txt = txt sep "{\"field\":\"" EVN[i] "\",\"from\":" js(PL[i]) ",\"to\":" js($(i + 2)) "}" }
        if (txt != "") { ng++; EGT[ng] = $2 + 0; EGX[ng] = txt }
    }
    next
}
$1 == "E" {
    t = $2 + 0
    item = "{\"field\":\"" $3 "\",\"from\":" js($4) ",\"to\":" js($5) "}"
    if (ng > 0 && EGT[ng] == t) EGX[ng] = EGX[ng] "," item
    else { ng++; EGT[ng] = t; EGX[ng] = item }
    next
}
$1 == "L" { for (i = 1; i <= NEV; i++) PL[i] = $(i + 2); havel = 1; next }

END {
    printf "{\"success\":true,\"view\":\"cells\",\"range\":\"%s\",\"generated_at\":%s,\"bucket_sec\":%s,", range, gen, bk
    printf "\"window\":{\"start\":%s,\"end\":%s,\"samples\":%d,\"first_ts\":%s,\"last_ts\":%s},", st, en, nw, ji(wfirst), ji(wlast)
    printf "\"coverage\":{\"cell_from\":%s},", ji(cov)
    printf "\"snapshot\":%s,", snapshot

    # --- series + missing ----------------------------------------------------
    printf "\"series\":{"
    nmiss = 0
    for (p = 1; p <= NP; p++) {
        name = PAN[p]
        id = (name == "lat" || name == "jit" || name == "loss") ? "p:" name : "m:" name
        printf "%s\"%s\":[%s]", (p > 1 ? "," : ""), name, OUT[id]
        if (OUT[id] == "") { nmiss++; MISS[nmiss] = name }
    }
    printf "},\"missing\":["
    for (i = 1; i <= nmiss; i++) printf "%s\"%s\"", (i > 1 ? "," : ""), MISS[i]
    printf "],"

    # --- cells ---------------------------------------------------------------
    printf "\"cells\":{\"availability\":[%s],\"availability_sec\":%s,\"outages\":[", OUT["v"], ab
    for (i = 1; i <= no; i++) printf "%s{\"start_ts\":%.0f,\"end_ts\":%.0f,\"samples\":%d}", (i > 1 ? "," : ""), OS[i], OE[i], ON[i]
    printf "],\"events\":["
    first = 1; shown = 0
    for (i = ng; i >= 1 && shown < 500; i--) { printf "%s{\"ts\":%.0f,\"changes\":[%s]}", (first ? "" : ","), EGT[i], EGX[i]; first = 0; shown++ }
    printf "],\"stats\":["
    # ties: earliest first, so the order never depends on hash iteration
    for (i = 1; i <= nsk; i++) SK[i] = SN[SKEY[i]] * 10000000000 + (9999999999 - SFIRST[SKEY[i]])
    sort_desc(nsk)
    for (j = 1; j <= nsk; j++) {
        k = SKEY[ORD[j]]
        printf "%s{\"key\":\"%s\",\"lte_pci\":%s,\"lte_band\":%s,\"lte_cellid\":%s,\"samples\":%d,\"nr_down\":%d,\"nr_known\":%d,\"first_ts\":%.0f,\"last_ts\":%.0f}", (j > 1 ? "," : ""), k, (k == "(none)" ? "null" : js(k)), js(SBAND[k]), js(SCID[k]), SN[k], SDOWN[k], SKNOWN[k], SFIRST[k], SLAST[k]
    }
    printf "],\"timeline\":["
    for (i = 1; i <= nt; i++)
        printf "%s{\"start_ts\":%.0f,\"end_ts\":%.0f,\"samples\":%d,\"lte_pci\":%s,\"lte_band\":%s,\"nr_band\":%s,\"nr_avail_pct\":%s}", (i > 1 ? "," : ""), TS[i], TE[i], TN[i], js(TLP[i]), js(TLB[i]), js(TNB[i]), (TKN[i] > 0 ? sprintf("%d", int(TUP[i] * 100 / TKN[i])) : "null")
    printf "],\"bands\":["
    for (i = 1; i <= nb; i++)
        printf "%s{\"start_ts\":%.0f,\"end_ts\":%.0f,\"samples\":%d,\"bands\":%s,\"ca_cc\":%s,\"bw_mhz\":%s}", (i > 1 ? "," : ""), BS[i], BE[i], BN[i], js(BKEY[i]), (BCAN[i] > 0 ? sprintf("%d", int(BCAS[i] / BCAN[i] + 0.5)) : "null"), (BBWN[i] > 0 ? fmt(BBWS[i] / BBWN[i]) : "null")
    printf "],\"band_series\":{"
    nbt = 0
    for (tok in BT) { nbt++; BTK[nbt] = tok; SK[nbt] = ((substr(tok, 1, 1) == "B") ? 0 : 1000) + substr(tok, 2) }
    sort_asc(nbt)
    for (j = 1; j <= nbt; j++) { tok = BTK[ORD[j]]; printf "%s\"%s\":[%s]", (j > 1 ? "," : ""), tok, OUT["b:" tok] }
    printf "},\"combos\":["
    for (i = 1; i <= nkk; i++) SK[i] = KN[KKEY[i]] * 10000000000 + (9999999999 - KFIRST[KKEY[i]])
    sort_desc(nkk)
    for (j = 1; j <= nkk; j++) {
        k = KKEY[ORD[j]]
        printf "%s{\"bands\":%s,\"samples\":%d,\"first_ts\":%.0f,\"last_ts\":%.0f,\"ca_cc\":%s,\"bw_mhz\":%s}", (j > 1 ? "," : ""), js(k), KN[k], KFIRST[k], KLAST[k], (KCAN[k] > 0 ? sprintf("%d", int(KCAS[k] / KCAN[k] + 0.5)) : "null"), (KBWN[k] > 0 ? fmt(KBWS[k] / KBWN[k]) : "null")
    }
    printf "]},"

    # --- history-v3 additions ------------------------------------------------
    printf "\"recorder\":%s,\"device_utc_offset_min\":%s,", recorder, offset
    printf "\"carriers\":["
    for (i = 1; i <= ndk; i++) { split(DK[i], kq, ":"); SK[i] = DS[DK[i]] * 100000000 - ((kq[1] == "L") ? 0 : 50000000) - kq[2] * 1000 - (kq[3] % 1000) }
    sort_desc(ndk)
    for (j = 1; j <= ndk; j++) {
        key = DK[ORD[j]]
        printf "%s{\"key\":\"%s\",\"tech\":\"%s\",\"band\":%s,\"arfcn\":%s,\"bw_mhz\":%s,\"role_pct_pcc\":%s,\"samples\":%d", (j > 1 ? "," : ""), key, (DT[key] == "L" ? "LTE" : "NR"), DB[key], DA[key], jn(DW[key]), fmt(100 * DP[key] / DS[key]), DS[key]
        printf ",\"rsrp\":[%s],\"rsrq\":[%s],\"sinr\":[%s],\"rssi\":[%s]}", OUT["c:" key ":rsrp"], OUT["c:" key ":rsrq"], OUT["c:" key ":sinr"], OUT["c:" key ":rssi"]
    }
    printf "],\"antennas\":["
    first = 1
    for (j = 1; j <= 8; j++) {
        if (OUT["a:" j] == "") continue
        printf "%s{\"tech\":\"%s\",\"port\":%d,\"rsrp\":[%s],\"median\":%s}", (first ? "" : ","), (j <= 4 ? "LTE" : "NR"), (j - 1) % 4, OUT["a:" j], jn(median(j))
        first = 0
    }
    printf "],\"congestion\":[%s],\"restarts\":%s}\n", OUT["g"], restarts
}
'

# Snapshot helper: the Z line (or nothing) -> {"carrier":null,...,"as_of":N}.
# A NOSVC newest row (the modem answered, nothing is serving) is not a network
# type: network_type is null and registered is false. The archive token itself,
# and the events that change to/from it, keep the literal "NOSVC" (the page
# translates it); only the live snapshot says "no network" in null/false.
HA_AWK_SNAPSHOT='
function jn(v) { return (v == "") ? "null" : v }
function js(v) { return (v == "") ? "null" : "\"" v "\"" }
BEGIN { FS = "\t"; z = 0 }
$1 == "Z" { z = 1; for (i = 1; i <= 16; i++) F[i] = $i }
END {
    if (!z) { for (i = 1; i <= 16; i++) F[i] = "" }
    reg = "null"
    if (F[15] == "NOSVC") { F[15] = ""; reg = "false" }
    printf "{\"carrier\":null,\"registered\":" reg ",\"cell\":{\"lte_pci\":%s,\"lte_earfcn\":%s,\"lte_band\":%s,\"lte_bw\":%s,\"lte_cellid\":%s,\"lte_tac\":%s,\"nr_pci\":%s,\"nr_arfcn\":%s,\"nr_band\":%s,\"nr_bw\":%s,\"nr_cellid\":%s,\"nr_tac\":%s,\"network_type\":%s,\"registered\":" reg ",\"nr_avail\":%s},\"as_of\":%s}", jn(F[3]), jn(F[4]), js(F[5]), jn(F[6]), jn(F[7]), jn(F[8]), jn(F[9]), jn(F[10]), js(F[11]), jn(F[12]), jn(F[13]), jn(F[14]), js(F[15]), jn(F[16]), jn(F[2])
}
'

# ---------------------------------------------------------------------------
# Reduce one archive piece to tagged TSV on stdout.
#   $1 kind (cell|ping)  $2 source file ("-" = none)  $3 start  $4 end
#   $5 bucket  $6 avail  $7 ring file ("-" = none)  $8 ring cut
# A ping piece that reaches the ring also reads its newest rows.
# ---------------------------------------------------------------------------
ha_reduce() {
    local src
    src="$2"
    if [ "$1" = "ping" ]; then
        {
            [ "$src" != "-" ] && ha_stream "$src"
            [ "$7" != "-" ] && tail -n "$HA_RING_TAIL_ROWS" "$7" 2>/dev/null
        } | ha_nice awk -v start="$3" -v end="$4" -v bucket="$5" -v cut="${8:-0}" "$HA_AWK_PING"
    else
        ha_stream "$src" | ha_nice awk -v start="$3" -v end="$4" -v bucket="$5" -v avail="$6" -v gap_sec="$HA_GAP_SEC" -v snap=0 "$HA_AWK_CELL"
    fi
}

ha_nice() {
    if [ "$HA_NICE" = "1" ] && command -v nice >/dev/null 2>&1; then
        nice -n 19 "$@"
    else
        "$@"
    fi
}

# Build one cache block: reduce into a temp file, move it into place. Returns 0
# with the block present, 1 when another builder holds it or the build failed.
#
# The source was resolved by ha_collect's first pass and is read here, up to the
# build budget later, while hs_maintain may gzip the day in between (gzip -c f >
# f.gz.tmp && mv && rm f). A plain file that vanished before the reducer opened it
# reads as an EMPTY stream, and an empty reduction is a perfectly valid block - it
# would then be cached for good as "that closed day had no rows". So after reducing
# the source is resolved AGAIN: if it is not the file that was read, the block is
# discarded and rebuilt once from the new source; if it still moved, or the day is
# gone, nothing is cached (the next request retries).
ha_cached_block() {
    local kind
    local src
    local cf
    local s
    local e
    local bucket
    local avail
    local lk
    local tmp
    local lm
    local dir
    local day
    local cur
    local pass
    local good
    kind=$1; src=$2; cf=$3; s=$4; e=$5; bucket=$6; avail=$7
    [ -f "$cf" ] && return 0
    lk="$cf.lock"
    if ! mkdir "$lk" 2>/dev/null; then
        lm=$(ha_mtime "$lk")
        if [ -n "$lm" ] && [ $(( $(date +%s) - lm )) -gt "$HA_LOCK_STALE_SEC" ]; then
            rmdir "$lk" 2>/dev/null
            mkdir "$lk" 2>/dev/null || return 1
        else
            return 1
        fi
    fi
    HA_LOCKS="$HA_LOCKS $lk"
    tmp="$cf.tmp.$$"
    HA_TMPS="$HA_TMPS $tmp"
    dir="${src%/*}"
    day="${src##*/}"
    day="${day%%.jsonl*}"
    good=0
    pass=0
    while [ "$pass" -lt 2 ]; do
        pass=$((pass + 1))
        if ha_reduce "$kind" "$src" "$s" "$e" "$bucket" "$avail" - 0 > "$tmp"; then
            cur=$(ha_day_src "$dir" "$day")
            if [ "$cur" = "$src" ] && [ -f "$src" ]; then
                good=1
                break
            fi
            # the source moved under the read: what was reduced is not trustworthy
            rm -f "$tmp" 2>/dev/null
            [ -n "$cur" ] || break
            src="$cur"
        else
            break
        fi
    done
    if [ "$good" = "1" ] && mv "$tmp" "$cf" 2>/dev/null; then
        [ -n "${QM_HIST_BUILD_LOG:-}" ] && printf 'built %s\n' "${cf##*/}" >> "$QM_HIST_BUILD_LOG" 2>/dev/null
        rmdir "$lk" 2>/dev/null
        return 0
    fi
    rm -f "$tmp" 2>/dev/null
    rmdir "$lk" 2>/dev/null
    return 1
}

# Resolve the source file of a day: the .gz wins when both exist (compression
# is in flight and the plain file is about to be deleted).
ha_day_src() {
    local f
    f="$1/$2.jsonl.gz"
    [ -f "$f" ] || f="$1/$2.jsonl"
    [ -f "$f" ] || f=""
    printf '%s' "$f"
}

# Collect the reduced TSV for every piece of [start, end], oldest first, into
# HA_FILES (space-separated paths). $1 kind (cell|ping) $2 dir $3 start $4 end
# $5 bucket $6 avail $7 ring file ("-") $8 ring cut $9 "build" for the detached
# builder (builds everything missing, serves nothing).
ha_collect() {
    local kind
    local dir
    local start
    local end
    local bucket
    local avail
    local ring
    local cut
    local mode
    local tag
    local plan
    local ents
    local pk
    local ps
    local pe
    local pd
    local pname
    local poff
    local src
    local cf
    local have
    local n
    local out
    local rg
    kind=$1; dir=$2; start=$3; end=$4; bucket=$5; avail=$6; ring=$7; cut=$8; mode=$9
    HA_FILES=""
    tag=r; [ "$kind" = "ping" ] && tag=p
    ents="$HA_WORK/ents.$kind"
    : > "$ents"

    plan=$(awk -v start="$start" -v end="$end" -v bucket="$bucket" -v slack="$HA_SEAL_SLACK" "$HA_AWK_PLAN")

    # pass 1: resolve sources and cache names
    while read -r pk ps pe pd pname poff; do
        [ -n "$pk" ] || continue
        src=$(ha_day_src "$dir" "$pname")
        cf="-"
        have=1
        case "$pk" in
            D)
                [ -n "$src" ] || continue
                cf="$HA_CACHE_DIR/$pname.$tag$bucket.d.$HA_CACHE_VER.tsv"
                ;;
            H)
                [ -n "$src" ] || continue
                cf="$HA_CACHE_DIR/$pname.$tag$bucket.h$(printf '%05d' "$poff").$HA_CACHE_VER.tsv"
                ;;
            L)
                # a live piece needs a source file, or (ping) the ring
                if [ -z "$src" ]; then
                    if [ "$kind" = "ping" ] && [ "$ring" != "-" ] && [ "$pe" -ge "$cut" ]; then src="-"; else continue; fi
                fi
                ;;
        esac
        if [ "$cf" != "-" ]; then
            if [ "$HA_NOCACHE" = "0" ]; then
                [ -f "$cf" ] || have=0
            else
                # no cache dir: every piece is reduced live
                pk=L; cf="-"
            fi
        fi
        printf '%s %s %s %s %s %s\n' "$pk" "$ps" "$pe" "${src:--}" "$cf" "$have" >> "$ents"
    done <<HA_PLAN_EOF
$plan
HA_PLAN_EOF

    # pass 2: build the missing blocks, newest first, inside the budget
    awk '$1 != "L" && $6 == 0 { a[++n] = $0 } END { for (i = n; i >= 1; i--) print a[i] }' "$ents" > "$ents.miss"
    while read -r pk ps pe src cf have; do
        [ -n "$pk" ] || continue
        if [ "$mode" != "build" ] && [ $(( $(date +%s) - HA_T0 )) -ge "$HA_BUDGET" ]; then
            HA_PARTIAL=1
            continue
        fi
        ha_cached_block "$kind" "$src" "$cf" "$ps" "$pe" "$bucket" "$avail" || HA_PARTIAL=1
    done < "$ents.miss"
    [ "$mode" = "build" ] && return 0

    # pass 3: assemble in time order; live pieces are reduced here
    n=0
    while read -r pk ps pe src cf have; do
        [ -n "$pk" ] || continue
        if [ "$pk" = "L" ]; then
            n=$((n + 1))
            out="$HA_WORK/l.$kind.$n"
            rg="-"
            if [ "$kind" = "ping" ] && [ "$ring" != "-" ] && [ "$pe" -ge "$cut" ]; then rg="$ring"; fi
            ha_reduce "$kind" "$src" "$ps" "$pe" "$bucket" "$avail" "$rg" "$cut" > "$out"
            HA_FILES="$HA_FILES $out"
        elif [ -f "$cf" ]; then
            HA_FILES="$HA_FILES $cf"
            HA_USED="$HA_USED ${cf##*/}"
        fi
    done < "$ents"
}

# Finish the blocks a request had no budget for, detached and at low priority.
# One builder at a time (bg.lock); a stale lock is taken over.
ha_bg_spawn() {
    local lk
    local lm
    [ "$HA_NOCACHE" = "0" ] || return 0
    lk="$HA_CACHE_DIR/bg.lock"
    if ! mkdir "$lk" 2>/dev/null; then
        lm=$(ha_mtime "$lk")
        if [ -n "$lm" ] && [ $(( $(date +%s) - lm )) -gt 900 ]; then
            rmdir "$lk" 2>/dev/null
            mkdir "$lk" 2>/dev/null || return 0
        else
            return 0
        fi
    fi
    (
        trap - EXIT INT TERM
        HA_TMPS=""
        HA_LOCKS=""
        HA_WORK="$HA_CACHE_DIR/wb.$$"
        HA_NICE=1
        HA_BUDGET=100000
        trap 'ha_cleanup; rmdir "$lk" 2>/dev/null' EXIT
        trap 'exit 1' INT TERM
        mkdir -p "$HA_WORK" 2>/dev/null || exit 0
        ha_collect cell "$HA_CELL_DIR" "$1" "$2" "$3" "$4" - 0 build
        [ -d "$HA_PING_DIR" ] && ha_collect ping "$HA_PING_DIR" "$1" "$2" "$3" "$4" - 0 build
        exit 0
    ) </dev/null >/dev/null 2>&1 &
}

# ---------------------------------------------------------------------------
# Recorder block + snapshot
# ---------------------------------------------------------------------------
# Sets HA_DIR_BYTES, HA_OLDEST_NAME, HA_NEWEST_NAME for the cell archive.
ha_scan_cell_dir() {
    local summary
    summary=$(ha_dir_summary "$HA_CELL_DIR")
    set -- $summary
    HA_DIR_BYTES=$1
    HA_OLDEST_NAME=$3
    HA_NEWEST_NAME=$4
}

# Sets HA_REC_JSON, HA_SNAP_JSON, HA_NEWEST_TS, HA_OLDEST_TS.
ha_recorder_and_snapshot() {
    local bytes
    local oldest
    local newest
    local zl
    local zo
    local state
    local free_kb
    local k
    local v
    local stale
    local l1
    local rs
    local archive_kb
    local free_json
    local stale_json
    bytes=$HA_DIR_BYTES; oldest=$HA_OLDEST_NAME; newest=$HA_NEWEST_NAME
    HA_NEWEST_TS=""
    HA_OLDEST_TS=""
    zl=""
    zo=""
    if [ "$newest" != "-" ] && [ -f "$HA_CELL_DIR/$newest" ]; then
        zl=$(ha_stream "$HA_CELL_DIR/$newest" | tail -n 5 | awk -v start=0 -v end=4000000000 -v bucket=60 -v avail=60 -v gap_sec=180 -v snap=1 "$HA_AWK_CELL")
        zo=$(ha_stream "$HA_CELL_DIR/$oldest" | head -n 3 | awk -v start=0 -v end=4000000000 -v bucket=60 -v avail=60 -v gap_sec=180 -v snap=2 "$HA_AWK_CELL")
    fi
    case "$zl" in
        Z*) HA_NEWEST_TS=$(printf '%s\n' "$zl" | awk -F'\t' '{print $2}') ;;
    esac
    case "$zo" in
        Z*) HA_OLDEST_TS=$(printf '%s\n' "$zo" | awk -F'\t' '{print $2}') ;;
    esac
    HA_SNAP_JSON=$(printf '%s\n' "$zl" | awk "$HA_AWK_SNAPSHOT")

    state=""; free_kb=""
    if [ -f "$HA_STATE_FILE" ]; then
        while IFS='=' read -r k v; do
            case "$k" in
                state) state=$v ;;
                free_kb) case "$v" in ''|*[!0-9]*) ;; *) free_kb=$v ;; esac ;;
            esac
        done < "$HA_STATE_FILE"
    fi
    if [ -z "$free_kb" ] && [ -d "$HA_CELL_DIR" ]; then
        free_kb=$(df -k "$HA_CELL_DIR" 2>/dev/null | awk 'NR == 2 { print $4 }')
        case "$free_kb" in ''|*[!0-9]*) free_kb="" ;; esac
    fi
    archive_kb=$(( (bytes + 1023) / 1024 ))

    stale=""
    [ -n "$HA_NEWEST_TS" ] && stale=$((HA_NOW - HA_NEWEST_TS))
    [ -n "$stale" ] && [ "$stale" -lt 0 ] && stale=0

    if [ "$HA_NOW" -lt "$HA_SANE_EPOCH" ]; then
        rs=clock_unset
    elif [ -z "$HA_NEWEST_TS" ]; then
        rs=empty
    elif [ "$stale" -le "$HA_GAP_SEC" ]; then
        rs=ok
    elif [ "$state" = "low_space" ]; then
        rs=low_space
    else
        rs=stale
    fi

    l1="${QM_L1_STATS:-}"
    if [ -z "$l1" ] && command -v uci >/dev/null 2>&1; then
        l1=$(uci -q get quecmanager.history.l1_stats 2>/dev/null)
    fi
    if [ "$l1" = "1" ]; then l1=true; else l1=false; fi

    free_json=null; [ -n "$free_kb" ] && free_json=$free_kb
    stale_json=null; [ -n "$stale" ] && stale_json=$stale
    HA_REC_JSON=$(printf '{"state":"%s","stale_sec":%s,"free_kb":%s,"archive_kb":%s,"oldest_ts":%s,"l1_enabled":%s}' \
        "$rs" "$stale_json" "$free_json" "$archive_kb" "${HA_OLDEST_TS:-null}" "$l1")
}

# ---------------------------------------------------------------------------
# Public entry points. Both print the whole response (no CGI headers) and
# return 0; callers have already validated the range.
# ---------------------------------------------------------------------------

# Write the merged response from $HA_WORK/resp.json to the cache and stdout.
ha_emit() {
    local rt
    local rf
    rt="$HA_WORK/resp.json"
    rf="$1"
    case "$(head -c 16 "$rt" 2>/dev/null)" in
        '{"success":true'*) ;;
        *) ha_agg_fail; return 0 ;;
    esac
    # a partial answer (blocks still being built) is never cached
    if [ "$HA_NOCACHE" = "0" ] && [ "$HA_PARTIAL" = "0" ]; then
        if cp "$rt" "$rf.tmp.$$" 2>/dev/null; then
            HA_TMPS="$HA_TMPS $rf.tmp.$$"
            mv "$rf.tmp.$$" "$rf" 2>/dev/null
            HA_USED="$HA_USED ${rf##*/}"
        fi
    fi
    [ "$HA_NOCACHE" = "0" ] && ha_evict
    cat "$rt"
}

# $1 range  $2 space-separated panel ids
ha_cells_response() {
    local range
    local panels
    local params
    local span
    local bucket
    local avail
    local start
    local end
    local key
    local rf
    local cell_files
    local ping_files
    local restarts
    local offset
    local newest_path
    range=$1; panels=$2
    ha_init
    params=$(ha_cells_params "$range") || return 1
    set -- $params
    span=$1; bucket=$2
    avail=$bucket
    [ "$avail" -gt 3600 ] && avail=3600
    end=$HA_NOW
    start=$((end - span))

    ha_trap_install
    ha_setup_dirs || { ha_agg_fail; return 0; }

    key=$(printf '%s' "$panels" | tr ' ' '_')
    rf="$HA_CACHE_DIR/resp_${range}_$key.json"
    ha_scan_cell_dir
    newest_path=""
    [ "$HA_NEWEST_NAME" != "-" ] && newest_path="$HA_CELL_DIR/$HA_NEWEST_NAME"
    if [ "$HA_NOCACHE" = "0" ] && [ -z "$QM_HIST_NO_RESP_CACHE" ] && ha_resp_fresh "$rf" "$HA_RESP_TTL_CELLS" "$newest_path"; then
        cat "$rf"
        return 0
    fi
    ha_recorder_and_snapshot

    cell_files=""
    ping_files=""
    if [ "$HA_NOW" -ge "$HA_SANE_EPOCH" ]; then
        ha_collect cell "$HA_CELL_DIR" "$start" "$end" "$bucket" "$avail" - 0
        cell_files=$HA_FILES
        if [ -d "$HA_PING_DIR" ]; then
            ha_collect ping "$HA_PING_DIR" "$start" "$end" "$bucket" "$avail" - 0
            ping_files=$HA_FILES
        fi
        [ "$HA_PARTIAL" = "1" ] && ha_bg_spawn "$start" "$end" "$bucket" "$avail"
    fi
    restarts=$(ha_restarts_json "$start" "$end")
    offset=$(ha_offset_min)

    # shellcheck disable=SC2086
    awk -v range="$range" -v gen="$HA_NOW" -v bucket="$bucket" -v avail="$avail" \
        -v start="$start" -v end="$end" -v gap_sec="$HA_GAP_SEC" -v panels="$panels" \
        -v snapshot="$HA_SNAP_JSON" -v recorder="$HA_REC_JSON" -v restarts="$restarts" \
        -v offset="$offset" "$HA_AWK_MERGE" /dev/null $cell_files $ping_files > "$HA_WORK/resp.json" 2>/dev/null
    ha_emit "$rf"
    return 0
}

ha_agg_fail() {
    printf '%s\n' '{"success":false,"error":"aggregation_failed","detail":"history aggregation produced no output"}'
}

# $1 range
ha_ping_response() {
    local range
    local params
    local span
    local bucket
    local start
    local end
    local rf
    local lastarc
    local newest
    local summary
    local ring
    local cut
    local restarts
    local offset
    local files
    range=$1
    ha_init
    params=$(ha_ping_params "$range") || return 1
    set -- $params
    span=$1; bucket=$2
    end=$HA_NOW
    start=$((end - span))

    ha_trap_install
    ha_setup_dirs || { ha_agg_fail; return 0; }

    rf="$HA_CACHE_DIR/resp_ping_$range.json"
    if [ "$HA_NOCACHE" = "0" ] && [ -z "$QM_HIST_NO_RESP_CACHE" ] && ha_resp_fresh "$rf" "$HA_RESP_TTL_PING" "$HA_RING_FILE"; then
        cat "$rf"
        return 0
    fi

    files=""
    if [ "$HA_NOW" -ge "$HA_SANE_EPOCH" ]; then
        summary=$(ha_dir_summary "$HA_PING_DIR")
        set -- $summary
        newest=$4
        lastarc=0
        if [ "$newest" != "-" ] && [ -f "$HA_PING_DIR/$newest" ]; then
            lastarc=$(ha_stream "$HA_PING_DIR/$newest" | tail -n 3 | sed -n 's/^\[\([0-9][0-9]*\),.*\]$/\1/p' | tail -n 1)
            case "$lastarc" in ''|*[!0-9]*) lastarc=0 ;; esac
        fi
        # ring rows are only for the minutes the archive does not have yet
        ring="-"
        cut=0
        if [ -f "$HA_RING_FILE" ] && [ -s "$HA_RING_FILE" ]; then
            ring="$HA_RING_FILE"
            [ "$lastarc" -gt 0 ] && cut=$(( lastarc / 60 * 60 + 59 ))
        fi
        if [ "$newest" = "-" ] && [ "$ring" != "-" ]; then
            # no persisted archive yet: the ring (up to ~24 h) is all there is
            HA_RING_TAIL_ROWS=100000
            ha_reduce ping - "$start" "$end" "$bucket" "$bucket" "$ring" 0 > "$HA_WORK/ring.all"
            files="$HA_WORK/ring.all"
        else
            ha_collect ping "$HA_PING_DIR" "$start" "$end" "$bucket" "$bucket" "$ring" "$cut"
            files=$HA_FILES
            [ "$HA_PARTIAL" = "1" ] && ha_bg_spawn "$start" "$end" "$bucket" "$bucket"
        fi
    fi
    restarts=$(ha_restarts_json "$start" "$end")
    offset=$(ha_offset_min)

    # shellcheck disable=SC2086
    awk -v range="$range" -v gen="$HA_NOW" -v bucket="$bucket" -v start="$start" -v end="$end" \
        -v restarts="$restarts" -v offset="$offset" "$HA_AWK_PINGMERGE" /dev/null $files > "$HA_WORK/resp.json" 2>/dev/null
    ha_emit "$rf"
    return 0
}
