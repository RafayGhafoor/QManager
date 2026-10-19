#!/bin/sh
# data_used.sh — persistent Data Used counter (ledger B5.21, U4.22).
#
# Sourced by qmanager_poller. Counts download (rx) and upload (tx) bytes on the
# aggregate cellular netdev across poller restarts, interface re-creation and
# reboots. Off the hot path by design (B5.29):
#   every cycle      one [ -f ] test for the reset flag (builtin, no fork)
#   every 15 cycles  two `read`s from sysfs + the RAM mirror (one mv)
#   every 10 samples the persistent file (qm_durable_write), also on reset and
#                    on poller stop (du_flush from the poller's TERM trap)
# status.json is not touched; network/data_used.sh serves the RAM mirror.
#
# Counter rules (docs/features/data-used.md):
#   cur >= prev               add cur - prev
#   cur <  prev (either dir)  the netdev restarted at 0: add cur, count a reset
#   boot_id changed           same as a restart, on the first sample of the boot
#   no state file             baseline only (bytes from before install are not ours)
#   netdev absent / garbage   skip the sample, iface_present=false
#
# rmnet_ipa0 is the aggregate WAN parent of rmnet_data* on SDX55/65/7X; rx is
# download on all three (fork data-counter-platform-matrix, RM551E check).
#
# The poller is the ONLY writer of both files; the reset CGI only drops a flag.

[ -n "$_QM_DATA_USED_LOADED" ] && return 0
_QM_DATA_USED_LOADED=1

# Overridable for scripts/test/data-used.sh.
: "${DU_IFACE:=rmnet_ipa0}"
: "${DU_SYS_DIR:=/sys/class/net}"
: "${DU_BOOT_ID_FILE:=/proc/sys/kernel/random/boot_id}"
: "${DU_STATE_DIR:=/usrdata/qmanager}"
: "${DU_RUN_DIR:=/var/run/qmanager}"
: "${DU_SAMPLE_EVERY:=15}"
: "${DU_FLUSH_EVERY:=10}"
DU_STATE_FILE="$DU_STATE_DIR/data_used.json"
DU_MIRROR="$DU_RUN_DIR/data_used.json"
DU_RESET_FLAG="$DU_RUN_DIR/data_used_reset"
DU_SCHEMA=1
# Below this the wall clock is the 1970 boot value: store 0, never a fake date.
DU_SANE_EPOCH=1700000000

_du_ready=0
_du_rx=0
_du_tx=0
_du_prev_rx=0
_du_prev_tx=0
_du_since=0
_du_updated=0
_du_resets=0
_du_present=false
_du_boot=""
_du_mode="baseline"    # baseline | rebase | delta
_du_n=0
_du_samples=0
_du_dirty=0

# _du_now: wall clock into _du_t (the poller's cycle _NOW when set), 0 if 1970.
_du_now() {
    _du_t="${_NOW:-}"
    case "$_du_t" in ''|*[!0-9]*) _du_t=$(date +%s 2>/dev/null) ;; esac
    case "$_du_t" in ''|*[!0-9]*) _du_t=0 ;; esac
    [ "$_du_t" -lt "$DU_SANE_EPOCH" ] && _du_t=0
}

_du_json() {
    printf '{"schema":%s,"rx_bytes":%s,"tx_bytes":%s,"since":%s,"updated":%s,"iface":"%s","iface_present":%s,"iface_resets":%s,"boot_id":"%s","prev_rx":%s,"prev_tx":%s}\n' \
        "$DU_SCHEMA" "$_du_rx" "$_du_tx" "$_du_since" "$_du_updated" \
        "$DU_IFACE" "$_du_present" "$_du_resets" "$_du_boot" \
        "$_du_prev_rx" "$_du_prev_tx"
}

# RAM mirror: /var/run/qmanager is root 0700, so a fixed tmp name is safe.
_du_write_mirror() {
    _du_json > "$DU_MIRROR.tmp" 2>/dev/null && mv -f "$DU_MIRROR.tmp" "$DU_MIRROR" 2>/dev/null
}

# du_flush: persist to flash. Called every DU_FLUSH_EVERY samples when counts
# moved, on reset, at init and from the poller's TERM trap.
du_flush() {
    [ "$_du_ready" = "1" ] || return 0
    [ -d "$DU_STATE_DIR" ] || mkdir -p "$DU_STATE_DIR" 2>/dev/null
    if command -v qm_durable_write >/dev/null 2>&1; then
        _du_json | qm_durable_write "$DU_STATE_FILE" 0644
    else
        _du_json > "$DU_STATE_FILE.tmp" 2>/dev/null &&
            sync && mv -f "$DU_STATE_FILE.tmp" "$DU_STATE_FILE" && sync
    fi
    _du_dirty=0
    _du_samples=0
}

# _du_sample: read the netdev counters and fold them in. Returns 1 when the
# netdev could not be read (state kept, iface_present=false).
_du_sample() {
    local _r
    local _x
    _r=""
    _x=""
    { read -r _r < "$DU_SYS_DIR/$DU_IFACE/statistics/rx_bytes"; } 2>/dev/null
    { read -r _x < "$DU_SYS_DIR/$DU_IFACE/statistics/tx_bytes"; } 2>/dev/null
    case "$_r" in ''|*[!0-9]*) _du_present=false; return 1 ;; esac
    case "$_x" in ''|*[!0-9]*) _du_present=false; return 1 ;; esac
    _du_present=true
    _du_now
    _du_updated="$_du_t"

    case "$_du_mode" in
        baseline)
            _du_mode="delta"
            ;;
        rebase)
            _du_rx=$((_du_rx + _r))
            _du_tx=$((_du_tx + _x))
            _du_mode="delta"
            ;;
        *)
            if [ "$_r" -lt "$_du_prev_rx" ] || [ "$_x" -lt "$_du_prev_tx" ]; then
                _du_resets=$((_du_resets + 1))
                _du_rx=$((_du_rx + _r))
                _du_tx=$((_du_tx + _x))
                qlog_info "data_used: $DU_IFACE counters restarted (rx $_du_prev_rx -> $_r); counting from 0"
            else
                _du_rx=$((_du_rx + _r - _du_prev_rx))
                _du_tx=$((_du_tx + _x - _du_prev_tx))
            fi
            ;;
    esac
    if [ "$_r" != "$_du_prev_rx" ] || [ "$_x" != "$_du_prev_tx" ]; then
        _du_dirty=1
    fi
    _du_prev_rx="$_r"
    _du_prev_tx="$_x"
    return 0
}

# _du_load: read the persisted state. Returns 1 (caller starts fresh) when the
# file is absent, another schema, or any field fails its guard.
_du_load() {
    local _line
    [ -f "$DU_STATE_FILE" ] || return 1
    _line=$(jq -r '[(.schema // 0), (.rx_bytes // 0), (.tx_bytes // 0),
                    (.since // 0), (.iface_resets // 0), (.prev_rx // 0),
                    (.prev_tx // 0),
                    (if (.boot_id // "") == "" then "-" else .boot_id end)]
                   | map(tostring) | join(" ")' "$DU_STATE_FILE" 2>/dev/null)
    [ -n "$_line" ] || return 1
    local _noglob
    _noglob=0
    case $- in *f*) _noglob=1 ;; esac
    set -f
    # shellcheck disable=SC2086
    set -- $_line
    [ "$_noglob" -eq 0 ] && set +f
    [ "$#" -eq 8 ] || return 1
    [ "$1" = "$DU_SCHEMA" ] || return 1
    local _v
    for _v in "$2" "$3" "$4" "$5" "$6" "$7"; do
        case "$_v" in ''|*[!0-9]*) return 1 ;; esac
    done
    _du_rx="$2"
    _du_tx="$3"
    _du_since="$4"
    _du_resets="$5"
    _du_prev_rx="$6"
    _du_prev_tx="$7"
    _du_file_boot="$8"
    return 0
}

# du_init: once at poller start, after safe_tmp.sh is loaded.
du_init() {
    if command -v qm_run_dir >/dev/null 2>&1; then
        qm_run_dir >/dev/null 2>&1
    else
        mkdir -p "$DU_RUN_DIR" 2>/dev/null
    fi
    _du_boot=""
    { read -r _du_boot < "$DU_BOOT_ID_FILE"; } 2>/dev/null
    case "$_du_boot" in ''|*[!0-9a-f-]*) _du_boot="" ;; esac

    _du_file_boot=""
    if _du_load; then
        if [ -n "$_du_boot" ] && [ "$_du_file_boot" = "$_du_boot" ]; then
            _du_mode="delta"
        else
            # New boot (or unknown boot): every byte on the netdev is new.
            _du_mode="rebase"
        fi
    else
        [ -f "$DU_STATE_FILE" ] && qlog_warn "data_used: state file unreadable, starting from zero"
        _du_rx=0
        _du_tx=0
        _du_resets=0
        _du_prev_rx=0
        _du_prev_tx=0
        _du_now
        _du_since="$_du_t"
        _du_mode="baseline"
    fi
    _du_ready=1
    _du_sample
    _du_write_mirror
    du_flush
    qlog_info "data_used: started (iface=$DU_IFACE mode=$_du_mode rx=$_du_rx tx=$_du_tx)"
}

_du_do_reset() {
    rm -f "$DU_RESET_FLAG"
    _du_rx=0
    _du_tx=0
    _du_resets=0
    _du_now
    _du_since="$_du_t"
    # Re-baseline on the netdev so only post-reset bytes count from here.
    _du_mode="baseline"
    _du_sample
    _du_write_mirror
    du_flush
    qlog_info "data_used: counters reset by user"
}

# du_tick: every poller cycle.
du_tick() {
    [ "$_du_ready" = "1" ] || return 0
    if [ -f "$DU_RESET_FLAG" ]; then
        _du_do_reset
        _du_n=0
        return 0
    fi
    _du_n=$((_du_n + 1))
    [ "$_du_n" -ge "$DU_SAMPLE_EVERY" ] || return 0
    _du_n=0
    _du_sample
    _du_write_mirror
    _du_samples=$((_du_samples + 1))
    if [ "$_du_dirty" = "1" ] && [ "$_du_samples" -ge "$DU_FLUSH_EVERY" ]; then
        du_flush
    fi
}
