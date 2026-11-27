#!/bin/sh
. "${QM_LIB_DIR:-/usr/lib/qmanager}/cgi_base.sh"
# =============================================================================
# fetch_ping_history.sh — CGI Endpoint for Ping History Chart Data
# =============================================================================
# Serves the ping history NDJSON file as a JSON array.
# Zero modem contact — reads from RAM only.
#
# The ping history file is NDJSON (one JSON object per line). This script
# converts it to a proper JSON array for the frontend.
#
# Each line format:
#   {"ts":1707900000,"lat":34.2,"avg":38.1,"min":12.3,"max":95.7,"loss":0,"jit":4.8}
#
# ?range=1h|6h|24h|7d (history-v3) serves the persisted per-minute archive as
# PingHistoryRanged (types/ping-history.ts), bucketed, with the current partial
# minute folded in from this RAM ring. See history_agg.sh. Without a range the
# output above is unchanged.
#
# Endpoint: GET /cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh[?range=]
# Response: application/json
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh
# =============================================================================

PING_HISTORY_FILE="/tmp/qmanager_ping_history.json"

HISTORY_AGG_LIB="${QM_LIB_DIR:-/usr/lib/qmanager}/history_agg.sh"
[ -f "$HISTORY_AGG_LIB" ] && . "$HISTORY_AGG_LIB"

qlog_init "cgi_fetch_ping_history"
cgi_headers
cgi_handle_options

serve_ping_ranged() {
    local range

    if ! type ha_ping_response >/dev/null 2>&1; then
        cgi_error "internal_error" "history aggregator unavailable"
        return
    fi
    range="${QUERY_STRING#*range=}"
    range="${range%%&*}"
    if ! ha_ping_params "$range" >/dev/null; then
        cgi_error "invalid_range" "range must be 1h, 6h, 24h or 7d"
        return
    fi
    ha_ping_response "$range"
}

case "&$QUERY_STRING" in
    *"&range="*) serve_ping_ranged ;;
    *) serve_ndjson_as_array "$PING_HISTORY_FILE" ;;
esac
exit 0
