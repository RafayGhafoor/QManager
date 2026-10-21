#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# neighbour_live_stop.sh — CGI Endpoint: stop the live neighbour reader
# =============================================================================
# Called by the Live Neighbours view when the page is REMOVED (tab closed, route
# left, component unmounted) so the 1 Hz AT reader stops immediately instead of
# lingering until its idle timeout. The reader's own idle stop remains as a
# backstop for a lost beacon (killed tab, suspended laptop, no network).
#
# Endpoint: POST /cgi-bin/quecmanager/at_cmd/neighbour_live_stop.sh
# Response: {"success":true,"stopped":true}              - reader gone
#           {"success":true,"stopped":true,"forced":true} - gone after SIGKILL
#           {"success":true,"stopped":false,"reason":"not_live"} - was a one-shot
#
# Never takes the shared scan lock: stopping a reader must not queue behind a
# full band sweep, and the reader itself never holds that lock.
# =============================================================================

qlog_init "cgi_neighbour_live_stop"
cgi_headers
cgi_handle_options

PID_FILE="/tmp/qmanager_neighbour_scan.pid"

if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

dead() {
    PID="$1"
    kill -0 "$PID" 2>/dev/null || return 0
    return 1
}

PID=$(cat "$PID_FILE" 2>/dev/null)
case "$PID" in
    ''|*[!0-9]*) printf '{"success":true,"stopped":false}\n'; exit 0 ;;
esac

if dead "$PID"; then
    rm -f "$PID_FILE"
    printf '{"success":true,"stopped":false}\n'
    exit 0
fi

# Never kill a one-shot scan from here. The PID file is shared by both modes, so
# the mode comes from the process's own command line — the /proc/<pid>/cmdline
# scan this runbook prescribes, not a pattern that could match the caller.
CMD=$(tr '\0' ' ' < "/proc/$PID/cmdline" 2>/dev/null)
case "$CMD" in
    *--live*) : ;;
    *)
        qlog_info "Stop requested but PID $PID is a one-shot scan - leaving it alone"
        printf '{"success":true,"stopped":false,"reason":"not_live"}\n'
        exit 0
        ;;
esac

# --- Escalate: TERM, then KILL ----------------------------------------------
# The reader does install `trap 'cleanup; exit 143' TERM`, and it was verified
# present in the deployed build - yet the process survived SIGTERM (measured
# twice). BusyBox ash defers a trap until the foreground child (`sleep 1`, or
# `qcmd`) returns, and that was not reliable enough here. SIGKILL cannot be
# deferred by anything, so this escalates rather than trusting shell trap timing.
# After a KILL the reader's own cleanup does not run: the PID file is removed
# here, and the kernel drops its flock when the process dies.
kill "$PID" 2>/dev/null
sleep 1

if dead "$PID"; then
    rm -f "$PID_FILE"
    qlog_info "Live neighbour reader stopped on request (PID $PID)"
    printf '{"success":true,"stopped":true}\n'
    exit 0
fi

qlog_warn "Live reader $PID ignored SIGTERM - sending SIGKILL"
kill -9 "$PID" 2>/dev/null
sleep 1

if dead "$PID"; then
    rm -f "$PID_FILE"
    qlog_info "Live neighbour reader stopped (SIGKILL, PID $PID)"
    printf '{"success":true,"stopped":true,"forced":true}\n'
    exit 0
fi

qlog_error "Live reader $PID survived SIGKILL - not our process?"
printf '{"success":true,"stopped":false,"reason":"still_running"}\n'
