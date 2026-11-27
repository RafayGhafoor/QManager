#!/bin/sh
. "${QM_LIB_DIR:-/usr/lib/qmanager}/cgi_base.sh"
# =============================================================================
# fetch_signal_history.sh - signal history chart data + cell history
# =============================================================================
# Two views of two different records. The default one is unchanged.
#
#   (no query)                       -> /tmp/qmanager_signal_history.json as a
#                                       JSON array: the last 2 minutes of
#                                       per-antenna signal, from RAM. Dashboard
#                                       chart only.
#   ?view=cells&range=<range>        -> the CellHistorySuccess contract
#                                       (types/cell-history.ts) for that window,
#                                       range 1h 3h 6h 12h 24h 7d 30d.
#                                       Optional &panels=a,b narrows `series`.
#
# The default view is a 2-minute RAM ring. "5G was gone at 03:00 - on which
# cell?" needs the durable archive (/usrdata/qmanager/cell_history/YYYY-MM-DD
# .jsonl[.gz], one row a minute, written by qmanager_poller). All of the
# aggregation lives in history_agg.sh (one awk pass per archive day, cached per
# closed day, one merge pass, no jq on the hot path); this file only validates
# the query and picks the view.
#
# The window ends at the WALL CLOCK, not at the newest row, so a stopped
# recorder shows an empty tail and `recorder.state` says why.
#
# Endpoint: GET /cgi-bin/quecmanager/at_cmd/fetch_signal_history.sh[?view=cells&range=]
# Response: application/json
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/fetch_signal_history.sh
# =============================================================================

SIGNAL_HISTORY_FILE="/tmp/qmanager_signal_history.json"

# Key set of `series` and the source of `missing[]`. Kept in step with
# CELL_HISTORY_PANELS in types/cell-history.ts.
CELL_ALL_PANELS="rsrp sinr rsrq rssi temp cqi rank mcs tx_power total_cells cpu mem dl ul ca bw lte_mcs nr_mcs lte_ri nr_ri lte_cqi nr_cqi ul_mcs lat jit loss"

HISTORY_AGG_LIB="${QM_LIB_DIR:-/usr/lib/qmanager}/history_agg.sh"
[ -f "$HISTORY_AGG_LIB" ] && . "$HISTORY_AGG_LIB"

qlog_init "cgi_fetch_signal_history"
cgi_headers
cgi_handle_options

# The default view: the dashboard's 2-minute per-antenna ring, byte-identical to
# what this endpoint served before the cells view existed.
serve_signal_history() {
    serve_ndjson_as_array "$SIGNAL_HISTORY_FILE"
}

serve_cells() {
    local range
    local panel_list
    local panels
    local p

    if ! type ha_cells_response >/dev/null 2>&1; then
        cgi_error "internal_error" "history aggregator unavailable"
        return
    fi

    range=24h
    case "&$QUERY_STRING" in
        *"&range="*)
            range="${QUERY_STRING#*range=}"
            range="${range%%&*}"
            ;;
    esac
    if ! ha_cells_params "$range" >/dev/null; then
        cgi_error "invalid_range" "range must be 1h, 3h, 6h, 12h, 24h, 7d or 30d"
        return
    fi

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
    panels=""
    for p in $panel_list; do
        case " $CELL_ALL_PANELS " in
            *" $p "*)
                case " $panels " in
                    *" $p "*) ;;
                    *) panels="$panels $p" ;;
                esac
                ;;
        esac
    done
    panels="${panels# }"
    [ -n "$panels" ] || panels="$CELL_ALL_PANELS"

    ha_cells_response "$range" "$panels"
}

case "&$QUERY_STRING" in
    *"&view=cells"*) serve_cells ;;
    *) serve_signal_history ;;
esac
exit 0
