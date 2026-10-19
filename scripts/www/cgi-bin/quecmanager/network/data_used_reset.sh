#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# data_used_reset.sh — CGI Endpoint: reset the Data Used counter (POST)
# =============================================================================
# Drops /var/run/qmanager/data_used_reset and waits for the poller to consume
# it (it checks every cycle, 2 s): the poller zeroes the counter, re-baselines
# on the netdev and persists at once. The poller stays the only writer.
#
# POST (no body) → {"success":true}
# Errors: poller_not_running (flag not consumed within WAIT_STEPS x 0.2 s; the
#         flag is removed so a later poller start does not reset by surprise)
#         reset_failed (flag could not be written)
#
# Endpoint: POST /cgi-bin/quecmanager/network/data_used_reset.sh
# Install location: /www/cgi-bin/quecmanager/network/data_used_reset.sh
# =============================================================================

qlog_init "cgi_data_used_reset"
cgi_headers
cgi_handle_options

WAIT_STEPS=25

if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_method_not_allowed
    exit 0
fi

run_dir=""
command -v qm_run_dir >/dev/null 2>&1 && run_dir=$(qm_run_dir 2>/dev/null)
if [ -z "$run_dir" ]; then
    qlog_error "data_used reset: run dir unavailable"
    cgi_error "reset_failed" "Run directory unavailable"
    exit 0
fi
flag="$run_dir/data_used_reset"

if ! : > "$flag" 2>/dev/null; then
    qlog_error "data_used reset: cannot write $flag"
    cgi_error "reset_failed" "Could not queue the reset"
    exit 0
fi
qlog_info "data_used reset requested"

i=0
while [ "$i" -lt "$WAIT_STEPS" ]; do
    sleep 0.2
    if [ ! -e "$flag" ]; then
        cgi_success
        exit 0
    fi
    i=$((i + 1))
done

rm -f "$flag"
qlog_warn "data_used reset: poller did not pick up the flag"
cgi_error "poller_not_running" "The poller did not respond"
