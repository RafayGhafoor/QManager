#!/bin/sh
# =============================================================================
# qcmd.sh — QManager Gatekeeper (LEGACY engine)
# =============================================================================
# /usr/bin/qcmd is a symlink managed by at_engine.sh: it points at the Rust AT
# broker (/usr/bin/qmanager_atd) by default, or at this script when the user
# selects the legacy engine (UCI quecmanager.at.engine=legacy). Kept for
# rollback; behaviour and output contract are identical.
#
# The SINGLE entry point for ALL AT command execution.
# Uses flock to serialize access to the modem and atcli_smd11 to talk to the
# AT character device, resolved at runtime by platform.sh (qm_at_device):
# /dev/smd11 on barebone RM551E images, /dev/mhi_DUN on PCIe/MHI-attached ODUs.
#
# Usage:
#   qcmd "AT+COMMAND"          → Execute AT command, return raw result
#   qcmd -j "AT+COMMAND"       → Execute AT command, return JSON-wrapped result
#
# Install location: /usr/bin/qcmd
# Dependencies: atcli_smd11, flock (busybox), timeout (busybox)
#
# atcli_smd11 is self-aware of AT command timeouts and waits correctly for
# long-running commands (AT+QSCAN=3,1, AT+QFOTADL, etc.). qcmd does NOT
# wrap it with an inner timeout; it only applies an outer safety cap so a
# wedged process cannot hang the lock forever.
# =============================================================================

# --- Logging -----------------------------------------------------------------
# Guarded with -f: BusyBox ash exits when `.` cannot find its file.
if [ -f /usr/lib/qmanager/qlog.sh ]; then
    . /usr/lib/qmanager/qlog.sh
else
    qlog_init() { :; }
    qlog_debug() { :; }
    qlog_info() { :; }
    qlog_warn() { :; }
    qlog_error() { :; }
    qlog_at_cmd() { :; }
    qlog_lock() { :; }
fi
qlog_init "qcmd"

# --- Platform ----------------------------------------------------------------
# Resolves the AT character device and provides fractional sleep. Guarded with
# -f like qlog.sh: BusyBox ash aborts when `.` cannot find its file.
if [ -f /usr/lib/qmanager/platform.sh ]; then
    . /usr/lib/qmanager/platform.sh
fi
if ! command -v qm_at_device >/dev/null 2>&1; then
    qm_at_device() { printf '%s' /dev/smd11; }
fi
if ! command -v qm_sleep_frac >/dev/null 2>&1; then
    qm_sleep_frac() { sleep "$1" 2>/dev/null || sleep 1; }
fi

AT_DEV="$(qm_at_device)"

# --- Configuration -----------------------------------------------------------
LOCK_FILE="/var/lock/qmanager.lock"
LONG_FLAG="/tmp/qmanager_long_running"
PID_FILE="/var/lock/qmanager.pid"

SAFETY_TIMEOUT=300      # outer last-ditch cap (seconds) — only fires if atcli_smd11 wedges
LOCK_WAIT_SHORT=5       # seconds to wait for lock (normal commands)
LOCK_WAIT_LONG=10       # seconds to wait for lock (long commands)

# Ensure lock directory exists
mkdir -p /var/lock 2>/dev/null

# --- Parse Arguments ---------------------------------------------------------
JSON_MODE=0
if [ "$1" = "-j" ]; then
    JSON_MODE=1
    shift
fi

COMMAND="$1"

if [ -z "$COMMAND" ]; then
    qlog_error "No command provided"
    echo '{"error":"no_command","detail":"Usage: qcmd [-j] \"AT+COMMAND\""}' >&2
    exit 1
fi

qlog_debug "Command received: ${COMMAND}"

# --- Helper: JSON Output -----------------------------------------------------
output_result() {
    local raw="$1"
    local err="$2"

    if [ "$JSON_MODE" -eq 1 ]; then
        if [ -n "$err" ]; then
            jq -n --arg error "$err" --arg command "$COMMAND" \
                '{success: false, error: $error, command: $command}'
        else
            jq -n --arg response "$raw" --arg command "$COMMAND" \
                '{success: true, response: $response, command: $command}'
        fi
    else
        if [ -n "$err" ]; then
            echo "ERROR: $err" >&2
            exit 1
        else
            echo "$raw"
        fi
    fi
}

# --- Helper: Command Classification -----------------------------------------
# Used only for the LONG_FLAG fast-reject path (blocks short commands while a
# scan is in progress). Timeout handling is internal to atcli_smd11.
is_long_command() {
    local cmd="$1"

    if [ -f /etc/qmanager/long_commands.list ]; then
        while IFS= read -r pattern; do
            case "$pattern" in
                '#'*|'') continue ;;
            esac
            case "$cmd" in
                *"$pattern"*) return 0 ;;
            esac
        done < /etc/qmanager/long_commands.list
    fi

    case "$cmd" in
        *QSCAN*|*QSCANFREQ*|*QFOTADL*) return 0 ;;
        *COPS=2*|*COPS=0*) return 0 ;;
        *) return 1 ;;
    esac
}

# --- Helper: Stale Lock Recovery ---------------------------------------------
check_stale_lock() {
    if [ -f "$PID_FILE" ]; then
        local old_pid
        old_pid=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$old_pid" ] && ! kill -0 "$old_pid" 2>/dev/null; then
            qlog_lock "stale_recovery" "$old_pid"
            rm -f "$PID_FILE"
            return 0
        fi
    fi
    return 1
}

# --- Helper: flock with timeout ----------------------------------------------
# BusyBox flock does NOT support -w (wait with timeout).
# We implement it: try -n (non-blocking), retry with sleep until deadline.
#
# Retry grain is 100ms (sleep 0.1), NOT 1s. The total wait budget is preserved
# by looping wait_secs*10 times -- e.g. wait_secs=5 -> 50 iters -> ~5s window.
# This matters because the poller holds qmanager.lock only ~40ms per AT call;
# a 1s retry grain made every contended qcmd pay a full second. 100ms grain
# cuts worst-case contention latency from ~1050ms to ~110ms while keeping the
# LOCK_WAIT_SHORT/LONG windows intact for SSR-storm resilience.
# Uses qm_sleep_frac (platform.sh), which falls back to usleep when BusyBox is
# built without FEATURE_FANCY_SLEEP -- verified absent on the Suncomm X75 ODU
# (BusyBox v1.33.2), where a bare `sleep 0.1` returns instantly and turns this
# loop into a busy spin. The 100ms grain is preserved either way.
#
# Usage: flock_wait <fd> <timeout_seconds>
# Returns: 0 = lock acquired, 1 = timed out
# -----------------------------------------------------------------------------
flock_wait() {
    local fd="$1"
    local wait_secs="$2"
    local iters
    local i
    iters=$((wait_secs * 10))
    i=0

    while [ "$i" -lt "$iters" ]; do
        if flock -x -n "$fd" 2>/dev/null; then
            return 0
        fi
        qm_sleep_frac 0.1
        i=$((i + 1))
    done

    # One final try
    flock -x -n "$fd" 2>/dev/null
    return $?
}

# =============================================================================
# EXECUTION
#
# Uses subshell + FD 9 redirect: ( flock 9; ...; ) 9>"$LOCK_FILE"
# Lock is auto-released when the subshell exits.
#
# Every child launched inside the locked subshell gets `9>&-`. BusyBox
# `timeout` forks a once-per-second watcher that would otherwise inherit FD 9
# and keep the flock held ~1s after a ~6ms AT exchange. The subshell still
# holds FD 9 for the full exchange, so serialization and SAFETY_TIMEOUT are
# unchanged; only the post-command lock leak goes away.
# =============================================================================

if is_long_command "$COMMAND"; then
    # =========================================================================
    # LONG COMMAND PATH
    # =========================================================================
    qlog_info "Long command started: ${COMMAND}"
    echo "$COMMAND" > "$LONG_FLAG"

    result=$(
        (
            if ! flock_wait 9 "$LOCK_WAIT_LONG"; then
                exit 2
            fi
            echo $$ > "$PID_FILE"

            # Warm-up: flush residual buffer + confirm modem responsive
            atcli_smd11 -p "$AT_DEV" 'AT' > /dev/null 2>&1 9>&- || { rm -f "$PID_FILE"; exit 3; }

            # Real command — atcli_smd11 self-times. Outer timeout is a last
            # resort in case the binary itself wedges.
            timeout "$SAFETY_TIMEOUT" atcli_smd11 -p "$AT_DEV" "$COMMAND" 2>/dev/null 9>&-
            cmd_rc=$?
            rm -f "$PID_FILE"
            exit $cmd_rc
        ) 9>"$LOCK_FILE"
    )
    exit_code=$?

    rm -f "$LONG_FLAG"

    case $exit_code in
        0)
            qlog_info "Long command completed: ${COMMAND}"
            qlog_at_cmd "$COMMAND" "$result" "$exit_code"
            output_result "$result" ""
            ;;
        2)
            qlog_error "Lock acquisition failed for: ${COMMAND}"
            output_result "" "modem_busy"
            exit 1
            ;;
        3)
            qlog_error "Modem warm-up failed before: ${COMMAND}"
            output_result "" "modem_not_ready"
            exit 1
            ;;
        124|143)
            qlog_error "Long command killed by safety timeout: ${COMMAND}"
            output_result "" "command_timeout"
            exit 1
            ;;
        *)
            qlog_error "Long command failed: ${COMMAND} (atcli_smd11 exit=${exit_code})"
            output_result "" "command_failed"
            exit 1
            ;;
    esac

elif [ -f "$LONG_FLAG" ]; then
    # =========================================================================
    # LONG COMMAND IN PROGRESS — Reject immediately
    # =========================================================================
    qlog_lock "blocked" "$(cat "$LONG_FLAG" 2>/dev/null)"
    output_result "" "scan_in_progress"
    exit 1

else
    # =========================================================================
    # SHORT COMMAND PATH
    # =========================================================================
    result=$(
        (
            if ! flock_wait 9 "$LOCK_WAIT_SHORT"; then
                exit 2
            fi
            echo $$ > "$PID_FILE"
            timeout "$SAFETY_TIMEOUT" atcli_smd11 -p "$AT_DEV" "$COMMAND" 2>/dev/null 9>&-
            cmd_rc=$?
            rm -f "$PID_FILE"
            exit $cmd_rc
        ) 9>"$LOCK_FILE"
    )
    exit_code=$?

    # Lock failed — try stale recovery and retry once
    if [ $exit_code -eq 2 ]; then
        qlog_lock "timeout" "short command: ${COMMAND}"

        if check_stale_lock; then
            result=$(
                (
                    if ! flock_wait 9 2; then
                        exit 2
                    fi
                    echo $$ > "$PID_FILE"
                    timeout "$SAFETY_TIMEOUT" atcli_smd11 -p "$AT_DEV" "$COMMAND" 2>/dev/null 9>&-
                    cmd_rc=$?
                    rm -f "$PID_FILE"
                    exit $cmd_rc
                ) 9>"$LOCK_FILE"
            )
            exit_code=$?
        fi

        if [ $exit_code -eq 2 ]; then
            qlog_error "Lock acquisition failed for: ${COMMAND}"
            output_result "" "modem_busy"
            exit 1
        fi
    fi

    qlog_at_cmd "$COMMAND" "$result" "$exit_code"

    case $exit_code in
        0)
            output_result "$result" ""
            ;;
        124|143)
            qlog_error "Short command killed by safety timeout: ${COMMAND}"
            output_result "" "command_timeout"
            exit 1
            ;;
        *)
            qlog_error "Short command failed: ${COMMAND} (atcli_smd11 exit=${exit_code})"
            output_result "" "command_failed"
            exit 1
            ;;
    esac
fi
