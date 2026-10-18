#!/bin/sh
# =============================================================================
# platform.sh — host-specific AT transport + sleep primitives
# =============================================================================
# The single home for the two things that legitimately differ between OpenWRT
# images carrying the same Quectel module. (qmanager_ping notes "no platform.sh
# on this target" next to its local qm_timeout fallback; this is that file.)
#
# 1. The AT character device.
#    Barebone RM520N/RM551E firmware exposes a single SMD channel at
#    /dev/smd11, which is what qcmd.sh, atcli_smd11 and the bundled sms_tool
#    all assume. Router-based ODUs carry the same module over PCIe/MHI
#    instead, where the AT channel is /dev/mhi_DUN (Suncomm X75 ODU:
#    MT7981 + RM551E-GL). Nothing in the modem's AT dialect changes — only
#    the device node.
#
# 2. Fractional sleep.
#    BusyBox only accepts `sleep 0.1` when built with FEATURE_FANCY_SLEEP.
#    Where that build option is absent the call fails instantly, so every
#    sub-second retry loop silently degrades into a busy spin instead of
#    waiting. qcmd.sh's 100ms flock grain is the load-bearing case.
#
# Sourced by: qcmd.sh, qmanager_sms_storage, qmanager_sms_forward,
#             sms_alerts.sh, cellular/sms.sh, cellular/sms_forwarding.sh,
#             install.sh
# Install location: /usr/lib/qmanager/platform.sh
# See: docs/features/at-broker.md, docs/devices/suncomm-x75-odu.md
# =============================================================================

[ -n "$_QM_PLATFORM_LOADED" ] && return 0
_QM_PLATFORM_LOADED=1

# Candidate order is deliberate: /dev/smd11 first keeps every existing
# deployment byte-identical, the MHI node covers PCIe-attached modules, and the
# ttyUSB entries cover USB-attached fallbacks.
QM_AT_CANDIDATES="${QM_AT_CANDIDATES:-/dev/smd11 /dev/mhi_DUN /dev/ttyUSB2 /dev/ttyUSB3}"

# Historical default — what every pre-existing build assumed.
QM_AT_FALLBACK="${QM_AT_FALLBACK:-/dev/smd11}"

# --- AT device ---------------------------------------------------------------

# qm_at_device — emit the AT character device to use.
#
# Resolution order (first hit wins):
#   1. $QM_AT_DEVICE                 per-invocation override (tests/debugging)
#   2. uci quecmanager.at.device     persistent, survives OTA; the shipped key
#   3. /etc/qmanager/atdev           one-line drop-in file
#   4. first existing $QM_AT_CANDIDATES entry
#   5. $QM_AT_FALLBACK
#
# Never fails: always prints a path. Callers pass it explicitly
# (`atcli_smd11 -p "$dev"`, `sms_tool -d "$dev"`), so a wrong guess is a
# visible error rather than a hang.
qm_at_device() {
    if [ -n "$QM_AT_DEVICE" ]; then
        printf '%s' "$QM_AT_DEVICE"
        return 0
    fi

    if command -v uci >/dev/null 2>&1; then
        _qmad_uci="$(uci -q get quecmanager.at.device 2>/dev/null)"
        if [ -n "$_qmad_uci" ]; then
            printf '%s' "$_qmad_uci"
            return 0
        fi
    fi

    if [ -r /etc/qmanager/atdev ]; then
        _qmad_file="$(head -n1 /etc/qmanager/atdev 2>/dev/null | tr -d ' \t\r\n')"
        if [ -n "$_qmad_file" ]; then
            printf '%s' "$_qmad_file"
            return 0
        fi
    fi

    for _qmad_cand in $QM_AT_CANDIDATES; do
        if [ -e "$_qmad_cand" ]; then
            printf '%s' "$_qmad_cand"
            return 0
        fi
    done

    printf '%s' "$QM_AT_FALLBACK"
}

# --- Sleep -------------------------------------------------------------------

# qm_sleep_frac <seconds> — sleep for a possibly fractional duration.
#
# Integers take the plain `sleep` fast path, which every BusyBox supports.
# Fractions try native support first (BusyBox with FEATURE_FANCY_SLEEP, GNU
# sleep), then `usleep` in microseconds — BusyBox provides that applet even
# when FANCY_SLEEP is off — and finally round up to a whole second. The point
# is that none of these paths can busy-spin.
qm_sleep_frac() {
    _qmsf_secs="$1"

    [ -n "$_qmsf_secs" ] || return 0

    case "$_qmsf_secs" in
        *[!0-9]*)
            ;;
        *)
            sleep "$_qmsf_secs"
            return 0
            ;;
    esac

    if sleep "$_qmsf_secs" 2>/dev/null; then
        return 0
    fi

    _qmsf_us="$(awk -v s="$_qmsf_secs" 'BEGIN { printf "%d", s * 1000000 }' 2>/dev/null)"
    if [ -n "$_qmsf_us" ] && [ "$_qmsf_us" -gt 0 ] 2>/dev/null; then
        if command -v usleep >/dev/null 2>&1; then
            usleep "$_qmsf_us" 2>/dev/null && return 0
        fi
        if command -v busybox >/dev/null 2>&1; then
            busybox usleep "$_qmsf_us" 2>/dev/null && return 0
        fi
    fi

    sleep 1
}
