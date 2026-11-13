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
#   ?view=cells&range=<range>        -> the serving-cell / NR-availability rows
#                                       the poller archived for that window.
#
# The default view is a 2-minute RAM ring, so it can answer "what is the signal
# doing" and nothing else. "5G was gone at 03:00 — on which cell?" needs the
# durable archive (/usrdata/qmanager/cell_history/YYYY-MM-DD.jsonl, one row a
# minute, written by qmanager_poller's append_cell_history), which is what
# ?view=cells reads. It rides this endpoint rather than adding a second CGI: one
# reader, one auth envelope, one place that knows the range vocabulary.
#
# The cells view serves the ROWS, not derived shapes. Availability buckets,
# outage spans, serving-cell runs and changes are computed in the browser
# (components/cellular/history/derive.ts) because a 24 h window is at most 1440
# rows — small enough that the derivation is cheaper to own in typed, unit-tested
# code than in an awk program on the device's only core. A range longer than a
# day would need the derivation here instead; that is why the range list stops
# at 24h.
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

# The cell-history window, as rows. Nothing is derived here beyond the times:
# `end` is the newest archived row clamped to now, never the wall clock, so an
# archive that stopped updating shows its last window instead of an empty chart.
serve_cells() {
    local range
    local span
    local now
    local last
    local end
    local start
    local startday
    local startnum
    local f
    local name
    local num
    local files

    range=24h
    case "&$QUERY_STRING" in
        *"&range="*)
            range="${QUERY_STRING#*range=}"
            range="${range%%&*}"
            ;;
    esac
    case "$range" in
        1h)  span=3600 ;;
        3h)  span=10800 ;;
        6h)  span=21600 ;;
        12h) span=43200 ;;
        24h) span=86400 ;;
        *)
            cgi_error "invalid_range" "range must be 1h, 3h, 6h, 12h or 24h"
            return
            ;;
    esac

    now=$(date +%s)

    # A 1970 clock (boot before NTP) cannot select files honestly: every row on
    # disk is newer than "now", so the window would be empty by construction and
    # read as "the archive recorded nothing".
    case "$now" in ''|*[!0-9]*) now=0 ;; esac
    if [ "$now" -lt "$SANE_EPOCH" ]; then
        printf '{"success":true,"view":"cells","range":"%s","generated_at":%s,"interval_sec":%s,"sane_epoch":false,"rows":[]}\n' \
            "$range" "$now" "$CELL_HISTORY_INTERVAL"
        return
    fi

    # The window ends at the newest archived row, not at now: a poller that
    # stopped an hour ago must show its last hour, not an hour of nothing.
    last=$(tail -n 1 "$CELL_HISTORY_DIR"/*.jsonl 2>/dev/null | tail -n 1)
    case "$last" in
        '{"ts":'*)
            last="${last#'{"ts":'}"
            last="${last%%,*}"
            case "$last" in ''|*[!0-9]*) last=0 ;; esac
            ;;
        *) last=0 ;;
    esac
    end="$now"
    if [ "$last" -gt 0 ] && [ "$last" -lt "$now" ]; then
        end="$last"
    fi
    start=$((end - span))
    [ "$start" -lt 0 ] && start=0

    # Only the day files the window can touch, oldest first (the glob is
    # lexical, and YYYY-MM-DD sorts correctly).
    files=""
    if [ "$start" -gt 0 ]; then
        startday=$(date -u -d "@$start" +%Y-%m-%d 2>/dev/null)
        startnum=$(daynum "$startday")
        case "$startnum" in ''|*[!0-9]*) startnum=0 ;; esac
        for f in "$CELL_HISTORY_DIR"/*.jsonl; do
            [ -f "$f" ] || continue
            name="${f##*/}"; name="${name%.jsonl}"
            num=$(daynum "$name")
            case "$num" in ''|*[!0-9]*) continue ;; esac
            [ "$num" -ge "$startnum" ] && files="$files $f"
        done
    fi

    printf '{"success":true,"view":"cells","range":"%s","generated_at":%s,"interval_sec":%s,"sane_epoch":true,"window_end":%s,"rows":[' \
        "$range" "$now" "$CELL_HISTORY_INTERVAL" "$end"
    # One pass, no jq: `ts` is the first key of every row, so the window filter
    # reads it positionally. Rows outside it are dropped; the client never sees
    # a row it did not ask for.
    if [ -n "$files" ]; then
        # shellcheck disable=SC2086
        cat $files 2>/dev/null \
            | awk -v re="$CELL_ROW_RE" -v start="$start" -v end="$end" '
                $0 ~ re {
                    t = $0
                    sub(/^[{]"ts":/, "", t)
                    sub(/,.*$/, "", t)
                    if (t + 0 >= start && t + 0 <= end) print
                }' \
            | sed -e '$!s/$/,/' | tr -d '\n'
    fi
    printf ']}\n'
}

case "&$QUERY_STRING" in
    *"&view=cells"*) serve_cells ;;
    *) serve_signal_history ;;
esac
exit 0
