#!/bin/sh
# lib.sh - shared helpers for the history-store tests (POSIX sh, BusyBox ash safe).
# Sourced by every t_*.sh. Nothing here touches anything outside $HT_TMP.
#
# Layout overrides (defaults assume the repo layout; on the device copy the libs
# flat and point HT_LIB / HT_POLLER at them):
#   HT_LIB      dir with history_store.sh l1_stats.sh parse_at.sh
#   HT_POLLER   path of qmanager_poller
#   HT_TMP      scratch dir (default /tmp/hv3a1/t)
#   HT_FIX      fixtures dir

HT_HERE="${HT_HERE:-$(cd "$(dirname "$0")" && pwd)}"
HT_ROOT="${HT_ROOT:-$HT_HERE/../..}"
HT_LIB="${HT_LIB:-$HT_ROOT/scripts/usr/lib/qmanager}"
HT_POLLER="${HT_POLLER:-$HT_ROOT/scripts/usr/bin/qmanager_poller}"
HT_TMP="${HT_TMP:-/tmp/hv3a1/t}"
HT_FIX="${HT_FIX:-$HT_HERE/fixtures}"
HT_PASS=0
HT_FAIL=0
HT_NAME="${HT_NAME:-test}"
mkdir -p "$HT_TMP" || exit 2

ht_ok() { HT_PASS=$((HT_PASS + 1)); }
ht_bad() {
    HT_FAIL=$((HT_FAIL + 1))
    printf 'FAIL %s: %s\n' "$HT_NAME" "$1"
    [ -n "${2:-}" ] && printf '       got : %s\n' "$2"
    [ -n "${3:-}" ] && printf '       want: %s\n' "$3"
}
# eq <what> <got> <want>
eq() { if [ "$2" = "$3" ]; then ht_ok; else ht_bad "$1" "$2" "$3"; fi; }
# yes <what> <command...>: command must succeed
yes() { _w="$1"; shift; if "$@" >/dev/null 2>&1; then ht_ok; else ht_bad "$_w"; fi; }
# no <what> <command...>: command must fail
no() { _w="$1"; shift; if "$@" >/dev/null 2>&1; then ht_bad "$_w (should have failed)"; else ht_ok; fi; }
ht_done() {
    printf '%s: %s passed, %s failed\n' "$HT_NAME" "$HT_PASS" "$HT_FAIL"
    [ "$HT_FAIL" -eq 0 ]
}

# ht_load_poller_fns: write the recorder / archive / boot-log code of the poller
# (and the helpers it calls) to $HT_TMP/poller_fns.sh so a test can source it
# without running the poller's main loop.
ht_load_poller_fns() {
    _o="$HT_TMP/poller_fns.sh"
    {
        printf '_CR=$(printf "\\r")\n_NL="\n"\n'
        awk '/^CELL_HISTORY_DIR=/ { p = 1 } p { print } /^SANE_EPOCH=/ { exit }' "$HT_POLLER"
        awk '/^_rm_chars\(\) \{/ { p = 1 } p { print } p && /^}/ { exit }' "$HT_POLLER"
        awk '/^# _jnum <token>/ { p = 1 } /^_sig_hist_n=/ { exit } p { print }' "$HT_POLLER"
        awk '/^# Cell history: one row a minute, append-only/ { p = 1 } /^# Append current ping\/connectivity stats/ { exit } p { print }' "$HT_POLLER"
        awk '/^# Ping-minute archive: \[ts/ { p = 1 } /^# TIER 2: WARM DATA/ { exit } p { print }' "$HT_POLLER"
    } > "$_o"
    # shellcheck disable=SC1090
    . "$_o"
}

# ht_stubs: the poller's logging and tap hooks.
ht_stubs() {
    log_info() { :; }
    log_warn() { HT_WARNS="${HT_WARNS:-}|$1"; }
    log_error() { :; }
    qlog_debug() { :; }
    qlog_info() { :; }
    qlog_warn() { :; }
    qlog_state_change() { :; }
    _tap_at() { :; }
}

# ht_epoch <YYYY-MM-DD> [HH:MM:SS]: UTC epoch, via the same civil arithmetic the
# poller uses in reverse (independent of the platform's date options).
ht_epoch() {
    _d="$1"; _t="${2:-00:00:00}"
    _y="${_d%%-*}"; _r="${_d#*-}"; _m="${_r%%-*}"; _dd="${_r#*-}"
    _h="${_t%%:*}"; _r="${_t#*:}"; _mi="${_r%%:*}"; _s="${_r#*:}"
    awk -v y="$_y" -v m="$_m" -v d="$_dd" -v h="$_h" -v mi="$_mi" -v s="$_s" 'BEGIN {
        if (m <= 2) { y -= 1; m += 12 }
        era = int(y / 400); yoe = y - era * 400
        doy = int((153 * (m - 3) + 2) / 5) + d - 1
        doe = yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy
        days = era * 146097 + doe - 719468
        printf "%d", days * 86400 + h * 3600 + mi * 60 + s }'
}
