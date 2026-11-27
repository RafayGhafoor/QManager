#!/bin/sh
# =============================================================================
# l1_stats.sh - gated L1 sampler for the cell-history row
# =============================================================================
# Sourced by qmanager_poller. OFF unless `uci -q get quecmanager.history.l1_stats`
# is exactly 1 (the poller sets L1_ENABLED from resolve_poller_config, which runs
# at start and again on the poller reload flag).
#
# What it reads (one compound AT exchange through the poller's _qc_read, so the
# QSCAN / long-command yield and the per-cycle busy latch apply unchanged):
#   LTE : lte_csi_ext ; lte_ulMCS ; up/down
#   NSA : lte_csi_ext ; nr5g_csi_ext ; nr5g_ulMCS ; lte_ulMCS ; up/down
#   SA  : nr5g_csi_ext ; nr5g_ulMCS ; up/down
# NEVER a *_mimo_layers read: it is a firmware hazard in the wrong RAT. MIMO
# rank is the RI field of *_csi_ext.
#
# Reply formats (measured on an RM551E, NSA):
#   +QNWCFG: "nr5g_csi_ext",1,<mcs>,<ri>,<cqi>,<pmi>,<f6>,<prb>,<f8>
#   +QNWCFG: "lte_csi_ext",1,<mcs>,<ri>,<cqi>,<pmi>,<f6>,<prb>,<f8>
#   +QNWCFG: "nr5g_ulMCS",1,<mcs>,<?>     +QNWCFG: "lte_ulMCS",1,<mcs>,<?>
#   +QNWCFG: "up/down",<ul_bits_s>,<dl_bits_s>,<interval>     (BITS per second)
# A leading 0 on a csi_ext / ulMCS line means reporting is off (a modem factory
# reset): that section records null.
#
# Gates (all): an AT-due cycle whose AT+QENG answered; network type and PCC PCI
# unchanged since the previous AT cycle (an identity change also drops the burst
# collected so far); no scan / SIM switch (the caller never gets here in those
# cases, and qcmd answers scan_in_progress otherwise); a busy reply abandons the
# rest of that minute.
#
# Sampling (sum/max/n accumulated until the row is written):
#   active : one exchange per 6 s while netdev DL > 1 Mbit/s, else one per row
#   idle   : two back-to-back per AT touch under the same traffic gate, else one
#   deep   : three back-to-back, only in the cycle a history row is due
#
# Accumulators are read once per row by l1_row_get and cleared by l1_accum_reset.
# =============================================================================

[ -n "${_L1_STATS_LOADED:-}" ] && return 0
_L1_STATS_LOADED=1

L1_ENABLED=0
# 1 = also read lte_ulMCS in NSA (the plan lists only nr5g_ulMCS there, the row
# schema carries lte_ul_mcs for NSA rows; measured to answer in NSA).
L1_NSA_LTE_ULMCS=1
L1_TRAFFIC_BPS=1000000     # netdev DL above this = traffic present (1 Mbit/s)
L1_ACTIVE_GAP=6            # seconds between exchanges under traffic, active tier
L1_ERR_LIMIT=3             # consecutive failed exchanges before a back-off
L1_BACKOFF_SEC=600
L1_SYS_NET="${L1_SYS_NET:-/sys/class/net}"

# netdev DL gate
_L1_IFACE=""
_L1_RX_PREV=""
_L1_RX_CLK=0
_L1_DL_BPS=0
# identity gate
_L1_PREV_NET=""
_L1_PREV_PCI=""
_L1_STABLE=0
# pacing
_L1_LAST_CLK=0
_L1_SKIP_MIN=""
_L1_ERR_STREAK=0
_L1_BACKOFF_UNTIL=0
# accumulators
_L1_N=0
_L1_LMCS_S=0; _L1_LMCS_N=0; _L1_LRI_MAX=""; _L1_LUL=""
_L1_NMCS_S=0; _L1_NMCS_N=0; _L1_NRI_MAX=""; _L1_NUL=""
_L1_NCQI_S=0; _L1_NCQI_N=0
_L1_PRB_S=0; _L1_PRB_N=0; _L1_PRB_MAX=""
_L1_DL_S=0; _L1_UL_S=0; _L1_BPS_N=0
# parsed reply
_L1_P_LMCS=""; _L1_P_LRI=""; _L1_P_LPRB=""; _L1_P_LUL=""
_L1_P_NMCS=""; _L1_P_NRI=""; _L1_P_NCQI=""; _L1_P_NPRB=""; _L1_P_NUL=""
_L1_P_UP=""; _L1_P_DL=""
_L1F1=""; _L1F2=""; _L1F3=""; _L1F4=""; _L1F5=""; _L1F6=""; _L1F7=""; _L1F8=""

# Row outputs of l1_row_get (a JSON number or null each).
L1R_LMCS=null; L1R_LRI=null; L1R_LUL=null
L1R_NMCS=null; L1R_NRI=null; L1R_NCQI=null; L1R_NUL=null
L1R_PRBM=null; L1R_PRBX=null; L1R_PRBN=null
L1R_DL=null; L1R_UL=null

# The poller defines these; stubs keep the lib loadable on its own (tests).
command -v _tap_at >/dev/null 2>&1 || _tap_at() { :; }
command -v qlog_debug >/dev/null 2>&1 || qlog_debug() { :; }
command -v qlog_info >/dev/null 2>&1 || qlog_info() { :; }
[ -n "${_CR:-}" ] || _CR=$(printf '\r')
[ -n "${_NL:-}" ] || _NL='
'

l1_accum_reset() {
    _L1_N=0
    _L1_LMCS_S=0; _L1_LMCS_N=0; _L1_LRI_MAX=""; _L1_LUL=""
    _L1_NMCS_S=0; _L1_NMCS_N=0; _L1_NRI_MAX=""; _L1_NUL=""
    _L1_NCQI_S=0; _L1_NCQI_N=0
    _L1_PRB_S=0; _L1_PRB_N=0; _L1_PRB_MAX=""
    _L1_DL_S=0; _L1_UL_S=0; _L1_BPS_N=0
}

# _l1_isnum <value> <max_digits>: 0 when the value is 1..max_digits digits.
_l1_isnum() {
    case "$1" in ''|*[!0-9]*) return 1 ;; esac
    [ "${#1}" -le "$2" ] || return 1
    return 0
}

# _l1_dec <digits>: _LD = the value without leading zeros ("0" stays "0").
_l1_dec() {
    _LD="$1"
    while :; do
        case "$_LD" in 0?*) _LD="${_LD#0}" ;; *) break ;; esac
    done
}

# _l1_split <csv>: _L1F1.._L1F8 = the first eight comma fields (CRs removed).
_l1_split() {
    local _ls_oifs
    local _ls_s
    _ls_s="$1"
    while :; do
        case "$_ls_s" in *"$_CR"*) _ls_s="${_ls_s%%"$_CR"*}${_ls_s#*"$_CR"}" ;; *) break ;; esac
    done
    _ls_oifs="$IFS"
    IFS=","
    set -f
    set -- $_ls_s
    set +f
    IFS="$_ls_oifs"
    _L1F1="${1:-}"; _L1F2="${2:-}"; _L1F3="${3:-}"; _L1F4="${4:-}"
    _L1F5="${5:-}"; _L1F6="${6:-}"; _L1F7="${7:-}"; _L1F8="${8:-}"
}

# _l1_csi <prefix L|N>: from the split fields of a *_csi_ext line (flag, mcs, ri,
# cqi, pmi, f6, prb, f8). Reporting off (flag != 1) leaves everything empty.
_l1_csi() {
    [ "$_L1F1" = "1" ] || return 0
    if _l1_isnum "$_L1F2" 3; then _l1_dec "$_L1F2"; eval "_L1_P_${1}MCS=\$_LD"; fi
    if _l1_isnum "$_L1F3" 2; then _l1_dec "$_L1F3"; eval "_L1_P_${1}RI=\$_LD"; fi
    if _l1_isnum "$_L1F7" 4; then _l1_dec "$_L1F7"; eval "_L1_P_${1}PRB=\$_LD"; fi
    if [ "$1" = "N" ] && _l1_isnum "$_L1F4" 2; then _l1_dec "$_L1F4"; _L1_P_NCQI="$_LD"; fi
}

# _l1_parse <raw reply>: fill _L1_P_*. Empty = absent, off or unparseable.
_l1_parse() {
    local _lp_rest
    local _lp_line
    local _lp_more
    _L1_P_LMCS=""; _L1_P_LRI=""; _L1_P_LPRB=""; _L1_P_LUL=""
    _L1_P_NMCS=""; _L1_P_NRI=""; _L1_P_NCQI=""; _L1_P_NPRB=""; _L1_P_NUL=""
    _L1_P_UP=""; _L1_P_DL=""
    _lp_rest="$1"
    _lp_more=1
    while [ "$_lp_more" = 1 ]; do
        case "$_lp_rest" in
            *"$_NL"*) _lp_line="${_lp_rest%%"$_NL"*}"; _lp_rest="${_lp_rest#*"$_NL"}" ;;
            *)        _lp_line="$_lp_rest"; _lp_rest=""; _lp_more=0 ;;
        esac
        case "$_lp_line" in
            '+QNWCFG: "lte_csi_ext",'*)
                _l1_split "${_lp_line#*\",}"; _l1_csi L ;;
            '+QNWCFG: "nr5g_csi_ext",'*)
                _l1_split "${_lp_line#*\",}"; _l1_csi N ;;
            '+QNWCFG: "lte_ulMCS",'*)
                _l1_split "${_lp_line#*\",}"
                if [ "$_L1F1" = "1" ] && _l1_isnum "$_L1F2" 3; then _l1_dec "$_L1F2"; _L1_P_LUL="$_LD"; fi ;;
            '+QNWCFG: "nr5g_ulMCS",'*)
                _l1_split "${_lp_line#*\",}"
                if [ "$_L1F1" = "1" ] && _l1_isnum "$_L1F2" 3; then _l1_dec "$_L1F2"; _L1_P_NUL="$_LD"; fi ;;
            '+QNWCFG: "up/down",'*)
                _l1_split "${_lp_line#*\",}"
                if _l1_isnum "$_L1F1" 12 && _l1_isnum "$_L1F2" 12; then
                    _l1_dec "$_L1F1"; _L1_P_UP="$_LD"
                    _l1_dec "$_L1F2"; _L1_P_DL="$_LD"
                fi ;;
        esac
    done
}

# _l1_max <current> <new>: _LM = the larger (empty current = new).
_l1_max() {
    if [ -z "$1" ] || [ "$2" -gt "$1" ]; then _LM="$2"; else _LM="$1"; fi
}

# _l1_accum: fold the parsed reply into the accumulators. PRB / PRB-share source
# is the NR carrier when the network has one, else the LTE carrier.
_l1_accum() {
    local _la_prb
    if [ -n "$_L1_P_LMCS" ]; then _L1_LMCS_S=$((_L1_LMCS_S + _L1_P_LMCS)); _L1_LMCS_N=$((_L1_LMCS_N + 1)); fi
    if [ -n "$_L1_P_LRI" ]; then _l1_max "$_L1_LRI_MAX" "$_L1_P_LRI"; _L1_LRI_MAX="$_LM"; fi
    [ -n "$_L1_P_LUL" ] && _L1_LUL="$_L1_P_LUL"
    if [ -n "$_L1_P_NMCS" ]; then _L1_NMCS_S=$((_L1_NMCS_S + _L1_P_NMCS)); _L1_NMCS_N=$((_L1_NMCS_N + 1)); fi
    if [ -n "$_L1_P_NRI" ]; then _l1_max "$_L1_NRI_MAX" "$_L1_P_NRI"; _L1_NRI_MAX="$_LM"; fi
    if [ -n "$_L1_P_NCQI" ]; then _L1_NCQI_S=$((_L1_NCQI_S + _L1_P_NCQI)); _L1_NCQI_N=$((_L1_NCQI_N + 1)); fi
    [ -n "$_L1_P_NUL" ] && _L1_NUL="$_L1_P_NUL"
    case "$network_type" in
        5G-NSA|5G-SA) _la_prb="$_L1_P_NPRB" ;;
        *)            _la_prb="$_L1_P_LPRB" ;;
    esac
    if [ -n "$_la_prb" ]; then
        _L1_PRB_S=$((_L1_PRB_S + _la_prb)); _L1_PRB_N=$((_L1_PRB_N + 1))
        _l1_max "$_L1_PRB_MAX" "$_la_prb"; _L1_PRB_MAX="$_LM"
    fi
    if [ -n "$_L1_P_DL" ]; then
        _L1_DL_S=$((_L1_DL_S + _L1_P_DL)); _L1_UL_S=$((_L1_UL_S + _L1_P_UP)); _L1_BPS_N=$((_L1_BPS_N + 1))
    fi
}

# _l1_mean <sum> <n>: _LM = rounded mean, "null" when n is 0.
_l1_mean() {
    if [ "$2" -gt 0 ]; then
        _LM=$(( ($1 * 2 + $2) / ($2 * 2) ))
    else
        _LM=null
    fi
}

# l1_row_get: the burst summary for the row being composed, into L1R_*.
l1_row_get() {
    L1R_LMCS=null; L1R_LRI=null; L1R_LUL=null
    L1R_NMCS=null; L1R_NRI=null; L1R_NCQI=null; L1R_NUL=null
    L1R_PRBM=null; L1R_PRBX=null; L1R_PRBN=null
    L1R_DL=null; L1R_UL=null
    [ "$L1_ENABLED" = "1" ] || return 0
    _l1_mean "$_L1_LMCS_S" "$_L1_LMCS_N"; L1R_LMCS="$_LM"
    L1R_LRI="${_L1_LRI_MAX:-null}"
    L1R_LUL="${_L1_LUL:-null}"
    _l1_mean "$_L1_NMCS_S" "$_L1_NMCS_N"; L1R_NMCS="$_LM"
    L1R_NRI="${_L1_NRI_MAX:-null}"
    _l1_mean "$_L1_NCQI_S" "$_L1_NCQI_N"; L1R_NCQI="$_LM"
    L1R_NUL="${_L1_NUL:-null}"
    _l1_mean "$_L1_PRB_S" "$_L1_PRB_N"; L1R_PRBM="$_LM"
    L1R_PRBX="${_L1_PRB_MAX:-null}"
    if [ "$_L1_PRB_N" -gt 0 ]; then L1R_PRBN="$_L1_PRB_N"; fi
    _l1_mean "$_L1_DL_S" "$_L1_BPS_N"; L1R_DL="$_LM"
    _l1_mean "$_L1_UL_S" "$_L1_BPS_N"; L1R_UL="$_LM"
}

# _l1_netdev: refresh _L1_DL_BPS from the WAN netdev rx counter (builtins only).
# The interface is the first readable of DU_IFACE (data_used.sh), rmnet_mhi0,
# rmnet_ipa0, rmnet_data0. A rate is only computed over >= 2 s; a counter that
# went backwards (interface reset) reads as no traffic.
_l1_netdev() {
    local _ln_i
    local _ln_rx
    local _ln_clk
    local _ln_dt
    if [ -z "$_L1_IFACE" ]; then
        for _ln_i in "${DU_IFACE:-}" rmnet_mhi0 rmnet_ipa0 rmnet_data0; do
            [ -n "$_ln_i" ] || continue
            if [ -r "$L1_SYS_NET/$_ln_i/statistics/rx_bytes" ]; then
                _L1_IFACE="$_ln_i"
                break
            fi
        done
        [ -n "$_L1_IFACE" ] || return 0
    fi
    _ln_rx=""
    { read -r _ln_rx < "$L1_SYS_NET/$_L1_IFACE/statistics/rx_bytes"; } 2>/dev/null
    _l1_isnum "$_ln_rx" 18 || return 0
    _ln_clk="${_MONO_TOP:-0}"
    [ "$_ln_clk" -gt 0 ] 2>/dev/null || _ln_clk="${_NOW:-0}"
    if [ -n "$_L1_RX_PREV" ]; then
        _ln_dt=$((_ln_clk - _L1_RX_CLK))
        if [ "$_ln_dt" -ge 2 ]; then
            if [ "$_ln_rx" -ge "$_L1_RX_PREV" ]; then
                _L1_DL_BPS=$(( (_ln_rx - _L1_RX_PREV) * 8 / _ln_dt ))
            else
                _L1_DL_BPS=0
            fi
            _L1_RX_PREV="$_ln_rx"
            _L1_RX_CLK="$_ln_clk"
        fi
    else
        _L1_RX_PREV="$_ln_rx"
        _L1_RX_CLK="$_ln_clk"
    fi
}

# _l1_exchange: one compound exchange for the current RAT. rc 0 answered,
# 1 failed / not understood, 3 busy or not run.
_l1_exchange() {
    local _le_cmd
    local _le_rc
    case "$network_type" in
        5G-SA)
            _le_cmd='AT+QNWCFG="nr5g_csi_ext";+QNWCFG="nr5g_ulMCS";+QNWCFG="up/down"' ;;
        5G-NSA)
            if [ "$L1_NSA_LTE_ULMCS" = "1" ]; then
                _le_cmd='AT+QNWCFG="lte_csi_ext";+QNWCFG="nr5g_csi_ext";+QNWCFG="nr5g_ulMCS";+QNWCFG="lte_ulMCS";+QNWCFG="up/down"'
            else
                _le_cmd='AT+QNWCFG="lte_csi_ext";+QNWCFG="nr5g_csi_ext";+QNWCFG="nr5g_ulMCS";+QNWCFG="up/down"'
            fi ;;
        LTE)
            _le_cmd='AT+QNWCFG="lte_csi_ext";+QNWCFG="lte_ulMCS";+QNWCFG="up/down"' ;;
        *) return 1 ;;
    esac
    _qc_read "$_le_cmd"
    _le_rc=$?
    _tap_at "$_le_cmd" "$_le_rc" "$_QRAW"
    [ "$_le_rc" -eq 3 ] && return 3
    case "$_QERR" in
        *"ERROR: modem_busy"*|*"ERROR: scan_in_progress"*|*"ERROR: invalid_command"*) return 3 ;;
    esac
    if [ "$_le_rc" -ne 0 ] || [ -z "$_QRAW" ]; then return 1; fi
    case "$_QRAW" in *ERROR*) return 1 ;; esac
    case "$_QRAW" in *'+QNWCFG:'*) ;; *) return 1 ;; esac
    _l1_parse "$_QRAW"
    _l1_accum
    _L1_N=$((_L1_N + 1))
    return 0
}

# l1_sample <row_due 0|1>: called once per AT-due cycle, after the QENG / QCAINFO /
# per-antenna reads, still inside the busy latch.
l1_sample() {
    local _lp_pci
    local _lp_clk
    local _lp_min
    local _lp_n
    local _lp_rc
    local _lp_i
    local _lp_want

    if [ "$L1_ENABLED" != "1" ]; then
        return 0
    fi
    [ "$_QENG_PARSED" = "1" ] || return 0

    case "$network_type" in
        5G-SA) _lp_pci="$nr_pci" ;;
        *)     _lp_pci="$lte_pci" ;;
    esac
    # Identity gate: only sample a cell and RAT seen on the previous AT cycle.
    if [ -n "$network_type" ] && [ -n "$_lp_pci" ] \
        && [ "$network_type" = "$_L1_PREV_NET" ] && [ "$_lp_pci" = "$_L1_PREV_PCI" ]; then
        _L1_STABLE=1
    else
        if [ "$_L1_STABLE" = "1" ] || [ "$_L1_PREV_NET" != "$network_type" ] || [ "$_L1_PREV_PCI" != "$_lp_pci" ]; then
            l1_accum_reset
        fi
        _L1_STABLE=0
    fi
    _L1_PREV_NET="$network_type"
    _L1_PREV_PCI="$_lp_pci"
    [ "$_L1_STABLE" = "1" ] || return 0

    _lp_clk="${_MONO_TOP:-0}"
    [ "$_lp_clk" -gt 0 ] 2>/dev/null || _lp_clk="${_NOW:-0}"
    _lp_min=$((${_NOW:-0} / 60))
    [ "$_lp_min" = "$_L1_SKIP_MIN" ] && return 0
    [ "${_NOW:-0}" -ge "$_L1_BACKOFF_UNTIL" ] || return 0
    [ "$_AT_BUSY" = "1" ] && { _L1_SKIP_MIN="$_lp_min"; return 0; }

    _l1_netdev

    _lp_want=0
    case "$ap_tier" in
        active)
            if [ "$_L1_DL_BPS" -gt "$L1_TRAFFIC_BPS" ]; then
                [ $((_lp_clk - _L1_LAST_CLK)) -ge "$L1_ACTIVE_GAP" ] && _lp_want=1
            else
                [ "$_L1_N" -eq 0 ] && _lp_want=1
            fi
            ;;
        idle)
            if [ "$_L1_DL_BPS" -gt "$L1_TRAFFIC_BPS" ]; then
                _lp_want=2
            else
                [ "$_L1_N" -eq 0 ] && _lp_want=1
            fi
            ;;
        deep)
            [ "${1:-0}" = "1" ] && _lp_want=3
            ;;
    esac
    [ "$_lp_want" -gt 0 ] || return 0

    _lp_i=0
    while [ "$_lp_i" -lt "$_lp_want" ]; do
        _l1_exchange
        _lp_rc=$?
        if [ "$_lp_rc" -eq 3 ]; then
            _L1_SKIP_MIN="$_lp_min"
            return 0
        elif [ "$_lp_rc" -ne 0 ]; then
            _L1_ERR_STREAK=$((_L1_ERR_STREAK + 1))
            if [ "$_L1_ERR_STREAK" -ge "$L1_ERR_LIMIT" ]; then
                _L1_BACKOFF_UNTIL=$((${_NOW:-0} + L1_BACKOFF_SEC))
                _L1_ERR_STREAK=0
                qlog_info "l1_stats: ${L1_ERR_LIMIT} failed exchanges in a row, pausing ${L1_BACKOFF_SEC}s"
            fi
            return 0
        fi
        _L1_ERR_STREAK=0
        _L1_LAST_CLK="$_lp_clk"
        _lp_i=$((_lp_i + 1))
    done
    return 0
}
