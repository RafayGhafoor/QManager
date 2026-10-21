#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# neighbour_scan_status.sh — CGI Endpoint: Neighbour Cell Scan Status
# =============================================================================
# Polled by the frontend to check neighbour scan progress.
# Returns idle/running/complete/error with results when available.
#
# Endpoint: GET /cgi-bin/quecmanager/at_cmd/neighbour_scan_status.sh
# Response:
#   {"status": "idle"}
#   {"status": "running"}
#   {"status": "complete", "results": [...]}
#   {"status": "error", "message": "..."}
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/neighbour_scan_status.sh
# =============================================================================

# --- Configuration -----------------------------------------------------------
PID_FILE="/tmp/qmanager_neighbour_scan.pid"
RESULT_FILE="/tmp/qmanager_neighbour_scan_result.json"
ERROR_FILE="/tmp/qmanager_neighbour_scan_error"
TS_FILE="/tmp/qmanager_neighbour_scan.ts"
READERS_FILE="/tmp/qmanager_neighbour_scan.readers"

qlog_init "cgi_neighbour_scan_status"
cgi_headers
cgi_handle_options

# --- Live mode: serve the current frame WHILE the reader runs -----------------
# A resident 1 Hz reader is alive for as long as somebody watches, so the
# "process running -> running" check below would hide its data for the entire
# session: the page would spin forever on a live view that is already updating
# the file once a second (change 27). A frame timestamp is the discriminator -
# only the live reader writes $TS_FILE, so a one-shot scan keeps the exact old
# running -> complete sequence.
LIVE_TS=$(cat "$TS_FILE" 2>/dev/null)
case "$LIVE_TS" in
''|*[!0-9]*) : ;;
*)
    if [ -f "$RESULT_FILE" ]; then
        FRAME=$(cat "$RESULT_FILE" 2>/dev/null)
        case "$FRAME" in
            '['*']')
                [ -e "$READERS_FILE" ] && ( : >> "$READERS_FILE" ) 2>/dev/null
                NOW=$(date +%s)
                AGE=$(( (NOW - LIVE_TS) * 1000 ))
                [ "$AGE" -lt 0 ] && AGE=0
                printf '{"status":"complete","live":true,"scanned_at":%s,"age_ms":%s,"results":%s}\n' \
                    "$LIVE_TS" "$AGE" "$FRAME"
                exit 0
                ;;
        esac
    fi
    ;;
esac

# --- Check: scanner process running? -----------------------------------------
if [ -f "$PID_FILE" ]; then
    SCAN_PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$SCAN_PID" ] && kill -0 "$SCAN_PID" 2>/dev/null; then
        # A live reader also writes this PID file, so "running" is what the page
        # attaches to in live mode too. Its results are already on disk.
        printf '{"status":"running"}\n'
        exit 0
    fi
    # Process died — clean up stale PID
    rm -f "$PID_FILE"
fi

# --- Check: result file present? ---------------------------------------------
if [ -f "$RESULT_FILE" ]; then
    # The file IS a JSON array; embed it verbatim. jq -n --slurpfile cost a
    # fixed ~440 ms per poll (AGENTS.md) and a 1 Hz live view would pay it every
    # second, for a value it could have `cat`ed.
    #
    # Age is reported only when the live reader wrote a timestamp, so a one-shot
    # scan keeps its exact previous response shape.
    RESULTS=$(cat "$RESULT_FILE" 2>/dev/null)
    case "$RESULTS" in
        '['*']') : ;;
        *) printf '{"status":"error","message":"Result file is not a JSON array"}\n'; exit 0 ;;
    esac
    # Touch the readers file so a running live reader knows somebody is watching.
    [ -e "$READERS_FILE" ] && ( : >> "$READERS_FILE" ) 2>/dev/null
    TS=$(cat "$TS_FILE" 2>/dev/null)
    case "$TS" in
        ''|*[!0-9]*) printf '{"status":"complete","results":%s}\n' "$RESULTS" ;;
        *)
            NOW=$(date +%s)
            AGE=$(( (NOW - TS) * 1000 ))
            [ "$AGE" -lt 0 ] && AGE=0
            printf '{"status":"complete","scanned_at":%s,"age_ms":%s,"results":%s}\n' \
                "$TS" "$AGE" "$RESULTS"
            ;;
    esac
    exit 0
fi

# --- Check: error file present? ----------------------------------------------
# Read-only: a GET must not consume the error, or one lost poll drops it and
# the page falls back to idle. The start CGI and the worker clear it.
# Checked AFTER the result: if a stray older error and a newer result both
# exist, the result wins (a real failure always removes the result first).
if [ -f "$ERROR_FILE" ]; then
    ERR_MSG=$(head -1 "$ERROR_FILE" 2>/dev/null)
    # Narrow guard: anything JSON cannot carry unescaped falls back to jq, which
    # is the previous behaviour verbatim.
    case "$ERR_MSG" in
        *[\"\\]*)
            jq -n --arg msg "$ERR_MSG" '{"status":"error","message":$msg}' ;;
        *)
            printf '{"status":"error","message":"%s"}\n' "$ERR_MSG" ;;
    esac
    exit 0
fi

# --- Default: idle (no scan has been run yet) ---------------------------------
printf '{"status":"idle"}\n'
