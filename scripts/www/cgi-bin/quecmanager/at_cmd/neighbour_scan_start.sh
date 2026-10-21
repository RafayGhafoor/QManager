#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# neighbour_scan_start.sh — CGI Endpoint: Start Neighbour Cell Scan
# =============================================================================
# Spawns the qmanager_neighbour_scanner background worker.
# Enforces singleton — only ONE scan may run at a time.
#
# Endpoint: POST /cgi-bin/quecmanager/at_cmd/neighbour_scan_start.sh
# Response: {"success": true}
#       or: {"success": false, "error": "already_running|other_scan_running|modem_busy|start_failed"}
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/neighbour_scan_start.sh
# =============================================================================

qlog_init "cgi_neighbour_scan"
cgi_headers
cgi_handle_options

# --- Configuration -----------------------------------------------------------
PID_FILE="/tmp/qmanager_neighbour_scan.pid"
RESULT_FILE="/tmp/qmanager_neighbour_scan_result.json"
TS_FILE="/tmp/qmanager_neighbour_scan.ts"
ERROR_FILE="/tmp/qmanager_neighbour_scan_error"
SCANNER_BIN="/usr/bin/qmanager_neighbour_scanner"
LONG_FLAG="/tmp/qmanager_long_running"
# Shared by cell_scan_start.sh and neighbour_scan_start.sh: a full sweep and a
# neighbour read must never run at once (or twice). The CGI takes it with
# flock -n on fd 7 and the spawned worker inherits fd 7, so the lock is held
# for the worker's whole run and the kernel drops it when the worker exits or
# is killed: no stale-lock cleanup, and acquire-then-spawn is atomic (the old
# PID-file check left a ~0.8 s window in which two POSTs both spawned).
# Opened read-only on purpose; never unlink it while a scan may run (the next
# opener would lock a new inode).
SCAN_LOCK="/tmp/qmanager_scan.lock"

# --- Validate method ---------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

# --- Singleton: the shared scan lock ----------------------------------------
# The PID files only say WHICH scan holds the lock (for the error code); the
# lock alone decides whether one is running.
# A failed redirection on a special builtin (`:`, `exec`) ends the shell, so
# the create runs in a subshell and the readability check guards the exec.
[ -e "$SCAN_LOCK" ] || ( : > "$SCAN_LOCK" ) 2>/dev/null
if [ ! -r "$SCAN_LOCK" ]; then
    qlog_error "Cannot open scan lock $SCAN_LOCK"
    cgi_error "start_failed" "Scan lock unavailable"
    exit 0
fi
exec 7<"$SCAN_LOCK"
if ! flock -x -n 7 2>/dev/null; then
    # already_running makes the page attach to the run in flight, so it must
    # only be returned for a scan of this kind; anything else is
    # other_scan_running. The winner writes its PID within ~10 ms of taking
    # the lock, so give a near-simultaneous start of the same kind a moment.
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -z "$OLD_PID" ]; then
        sleep 0.3
        OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    fi
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        qlog_warn "Neighbour scan already running (PID: $OLD_PID)"
        cgi_error "already_running" "A neighbour scan is already in progress"
    else
        qlog_warn "Neighbour scan blocked: another scan holds the modem"
        cgi_error "other_scan_running" "A full cell scan is using the modem. Wait for it to finish."
    fi
    exit 0
fi

# --- Live mode? --------------------------------------------------------------
# A live reader is spawned WITHOUT the scan lock (see the spawn below), so its
# own PID file is the only singleton it needs. If one is already alive, attach
# to it: a second tab must not start a second 1 Hz AT reader.
LIVE=0
case "$QUERY_STRING" in
    *live=1*) LIVE=1 ;;
esac
if [ "$LIVE" = "1" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        qlog_info "Live neighbour reader already running (PID: $OLD_PID), attaching"
        printf '{"success":true,"pid":%s,"live":true,"attached":true}\n' "$OLD_PID"
        exit 0
    fi
fi

# Lock held: any PID file left now is stale.
rm -f "$PID_FILE"

# --- Check: modem already busy with another long command? --------------------
if [ -f "$LONG_FLAG" ]; then
    CURRENT_CMD=$(cat "$LONG_FLAG" 2>/dev/null)
    qlog_warn "Modem busy with long command: $CURRENT_CMD"
    cgi_error "modem_busy" "Modem is busy with another long command"
    exit 0
fi

# --- Clean up previous results -----------------------------------------------
# TS_FILE is the discriminator the status CGI uses to decide "live frame" vs
# "one-shot result": it exists IF AND ONLY IF a live reader is publishing. A
# one-shot scan after a live session would otherwise be reported as live with a
# stale age (measured: `"live":true,"scanned_at":...,"age_ms":2200` on a scan
# that had just run), so it is cleared here for both paths - a live reader
# republishes its first frame within a second.
rm -f "$RESULT_FILE" "$ERROR_FILE" "$TS_FILE"

# --- Launch scanner in background --------------------------------------------
# fd 7 (the lock) is inherited by the worker. The CGI writes the PID itself
# from $! so the first status poll never sees "no pid, no result" (idle) for a
# scan that is starting; the worker writes the same value as $$.
# live=1 runs the same worker in its resident 1 Hz mode. It must NOT inherit the
# scan lock (fd 7): a live reader is not a scan, and holding that lock for its
# whole life would block manual scans and full sweeps. Closing fd 7 releases it
# when this CGI exits.
case "$LIVE" in
    1) ( "$SCANNER_BIN" --live </dev/null >/dev/null 2>&1 7>&- & echo $! > "$PID_FILE" ) ;;
    *) ( "$SCANNER_BIN" </dev/null >/dev/null 2>&1 & echo $! > "$PID_FILE" ) ;;
esac

# A missing or non-executable worker dies at once; a healthy one holds the
# modem for seconds to minutes, so a short look is unambiguous.
sleep 0.2
NEW_PID=$(cat "$PID_FILE" 2>/dev/null)
case "$NEW_PID" in ''|*[!0-9]*) NEW_PID="" ;; esac
if [ -z "$NEW_PID" ] || ! kill -0 "$NEW_PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    qlog_error "Neighbour scanner failed to start"
    cgi_error "start_failed" "Scanner process did not start"
    exit 0
fi

qlog_info "Neighbour scan started (PID: $NEW_PID, live=$LIVE)"
case "$LIVE" in
    1) printf '{"success":true,"pid":%s,"live":true}\n' "$NEW_PID" ;;
    *) printf '{"success":true,"pid":%s}\n' "$NEW_PID" ;;
esac
