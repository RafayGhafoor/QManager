#!/bin/sh
# ondemand_radio.sh — On-demand Layer-1-adjacent radio reads.
#
# These reads (MIMO layers, timing advance, CGCONTRDP, QMAP="WWAN") used to run
# on the recurring poller timer. They are L1/RF-measurement / data-plane reads:
# issuing them on a background timer eventually lands one mid-RAT-transition or
# mid-cell-reselection, which on the RM551E-GL correlates with a Qualcomm MPSS
# baseband SSR (recoverable radio restart). QuecManager — which lacks the drop
# bug — never polls these; it reads them only while the relevant UI page is open.
#
# This library relocates those reads OFF the recurring poller and behind an
# on-demand CGI endpoint. The poller's write_cache() reads last-known values
# back from /tmp/qmanager_ondemand.json so display fields retain their values
# between fetches (they are display-only and slow-changing).
#
# Source AFTER parse_at.sh (uses parse_mimo / parse_time_advance /
# parse_cgcontrdp / parse_wan_ip / parse_serving_cell) and AFTER a logging
# library (qlog.sh or cgi_base.sh).

[ -n "$_ONDEMAND_RADIO_LOADED" ] && return 0
_ONDEMAND_RADIO_LOADED=1

# Last-known on-demand radio values. Read by the poller's write_cache(), written
# by ondemand_radio_fetch(). Display-only; survives between on-demand fetches.
ONDEMAND_CACHE_FILE="/tmp/qmanager_ondemand.json"
ONDEMAND_CACHE_TMP="/tmp/qmanager_ondemand.json.tmp"

# No-op logging fallbacks if sourced before a logging library.
command -v qlog_debug >/dev/null 2>&1 || qlog_debug() { :; }
command -v qlog_warn  >/dev/null 2>&1 || qlog_warn()  { :; }
command -v qlog_info  >/dev/null 2>&1 || qlog_info()  { :; }

# ---------------------------------------------------------------------------
# load_ondemand_cache
# Read last-known on-demand radio values from ONDEMAND_CACHE_FILE into the
# shell variables the poller's write_cache() emits. No-op (leaves whatever the
# caller already has) when the file is absent — so a first boot before any
# on-demand fetch simply emits the initialized-empty defaults.
#
# Populates:
#   t2_mimo, lte_ta, nr_ta,
#   t2_apn, t2_wan_ipv4, t2_wan_ipv6,
#   t2_primary_dns, t2_secondary_dns,
#   t2_primary_dns_v4, t2_primary_dns_v6,
#   t2_secondary_dns_v4, t2_secondary_dns_v6
# ---------------------------------------------------------------------------
load_ondemand_cache() {
    # Fast path: companion shell-snippet cache written alongside the JSON by
    # _ondemand_write_cache. Dot-sourcing costs ~0 forks, where the jq path
    # below costs one jq startup (~0.4-0.7s of CPU on a slow SoC) and is
    # entered on EVERY poll cycle. Falls back to jq when the snippet is absent.
    local _odc_env="${ONDEMAND_CACHE_FILE}.env"
    if [ -s "$_odc_env" ]; then
        . "$_odc_env"
        return 0
    fi

    [ -s "$ONDEMAND_CACHE_FILE" ] || return 0

    # Emit the 12 fields in a fixed order, one value per line, then read them
    # back positionally. // handling is explicit: a missing key (or JSON null)
    # becomes an empty line. These fields are all display strings, so a missing
    # key legitimately means "no value known" — adopting empty is correct (the
    # poller no longer touches these, so we are not clobbering fresh data).
    # Newlines never appear inside any of these values (APN / IP / DNS /
    # mimo-label), so line-positional read is safe.
    _olc_dump=$(jq -r '
        (if .mimo == null then "" else .mimo end),
        (if .lte_ta == null then "" else .lte_ta end),
        (if .nr_ta == null then "" else .nr_ta end),
        (if .apn == null then "" else .apn end),
        (if .wan_ipv4 == null then "" else .wan_ipv4 end),
        (if .wan_ipv6 == null then "" else .wan_ipv6 end),
        (if .primary_dns == null then "" else .primary_dns end),
        (if .secondary_dns == null then "" else .secondary_dns end),
        (if .primary_dns_v4 == null then "" else .primary_dns_v4 end),
        (if .primary_dns_v6 == null then "" else .primary_dns_v6 end),
        (if .secondary_dns_v4 == null then "" else .secondary_dns_v4 end),
        (if .secondary_dns_v6 == null then "" else .secondary_dns_v6 end)
    ' "$ONDEMAND_CACHE_FILE" 2>/dev/null)

    [ -n "$_olc_dump" ] || return 0

    # Read the 12 lines positionally. sed -n 'Np' keeps empty fields addressable.
    t2_mimo=$(printf '%s\n' "$_olc_dump" | sed -n '1p')
    lte_ta=$(printf '%s\n' "$_olc_dump" | sed -n '2p')
    nr_ta=$(printf '%s\n' "$_olc_dump" | sed -n '3p')
    t2_apn=$(printf '%s\n' "$_olc_dump" | sed -n '4p')
    t2_wan_ipv4=$(printf '%s\n' "$_olc_dump" | sed -n '5p')
    t2_wan_ipv6=$(printf '%s\n' "$_olc_dump" | sed -n '6p')
    t2_primary_dns=$(printf '%s\n' "$_olc_dump" | sed -n '7p')
    t2_secondary_dns=$(printf '%s\n' "$_olc_dump" | sed -n '8p')
    t2_primary_dns_v4=$(printf '%s\n' "$_olc_dump" | sed -n '9p')
    t2_primary_dns_v6=$(printf '%s\n' "$_olc_dump" | sed -n '10p')
    t2_secondary_dns_v4=$(printf '%s\n' "$_olc_dump" | sed -n '11p')
    t2_secondary_dns_v6=$(printf '%s\n' "$_olc_dump" | sed -n '12p')

    unset _olc_dump
    return 0
}

# ---------------------------------------------------------------------------
# _ondemand_write_cache
# Persist the current on-demand radio variables to ONDEMAND_CACHE_FILE so the
# poller (and the next fetch) retain last-known values. Atomic via tmp+mv.
# Internal — callers use ondemand_radio_fetch().
# ---------------------------------------------------------------------------
_odc_json_str() {
    printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}

# POSIX single-quote for a shell literal, for the companion snippet file below.
_odc_shq() {
    printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

_ondemand_write_cache() {
    # Emitted with printf rather than `jq -n`: jq startup is ~0.4-0.7s of CPU on
    # a slow SoC, and the poller reads this cache back every cycle. Values are
    # display strings; output is compact rather than pretty-printed.
    local _odc_ts
    _odc_ts=$(date +%s)
    printf '{"mimo":%s,"lte_ta":%s,"nr_ta":%s,"apn":%s,"wan_ipv4":%s,"wan_ipv6":%s,"primary_dns":%s,"secondary_dns":%s,"primary_dns_v4":%s,"primary_dns_v6":%s,"secondary_dns_v4":%s,"secondary_dns_v6":%s,"updated_at":%s}\n' \
        "$(_odc_json_str "${t2_mimo:-}")" \
        "$(_odc_json_str "${lte_ta:-}")" \
        "$(_odc_json_str "${nr_ta:-}")" \
        "$(_odc_json_str "${t2_apn:-}")" \
        "$(_odc_json_str "${t2_wan_ipv4:-}")" \
        "$(_odc_json_str "${t2_wan_ipv6:-}")" \
        "$(_odc_json_str "${t2_primary_dns:-}")" \
        "$(_odc_json_str "${t2_secondary_dns:-}")" \
        "$(_odc_json_str "${t2_primary_dns_v4:-}")" \
        "$(_odc_json_str "${t2_primary_dns_v6:-}")" \
        "$(_odc_json_str "${t2_secondary_dns_v4:-}")" \
        "$(_odc_json_str "${t2_secondary_dns_v6:-}")" \
        "$_odc_ts" > "$ONDEMAND_CACHE_TMP" 2>/dev/null && mv "$ONDEMAND_CACHE_TMP" "$ONDEMAND_CACHE_FILE"

    # Companion shell-snippet cache: the same 12 variables by name, so
    # load_ondemand_cache() can restore them by dot-sourcing instead of paying a
    # jq invocation every poll cycle. Written atomically; additive (the jq path
    # below remains as a fallback when this file is absent).
    {
        printf 't2_mimo=%s\n'             "$(_odc_shq "${t2_mimo:-}")"
        printf 'lte_ta=%s\n'              "$(_odc_shq "${lte_ta:-}")"
        printf 'nr_ta=%s\n'               "$(_odc_shq "${nr_ta:-}")"
        printf 't2_apn=%s\n'              "$(_odc_shq "${t2_apn:-}")"
        printf 't2_wan_ipv4=%s\n'         "$(_odc_shq "${t2_wan_ipv4:-}")"
        printf 't2_wan_ipv6=%s\n'         "$(_odc_shq "${t2_wan_ipv6:-}")"
        printf 't2_primary_dns=%s\n'      "$(_odc_shq "${t2_primary_dns:-}")"
        printf 't2_secondary_dns=%s\n'    "$(_odc_shq "${t2_secondary_dns:-}")"
        printf 't2_primary_dns_v4=%s\n'   "$(_odc_shq "${t2_primary_dns_v4:-}")"
        printf 't2_primary_dns_v6=%s\n'   "$(_odc_shq "${t2_primary_dns_v6:-}")"
        printf 't2_secondary_dns_v4=%s\n' "$(_odc_shq "${t2_secondary_dns_v4:-}")"
        printf 't2_secondary_dns_v6=%s\n' "$(_odc_shq "${t2_secondary_dns_v6:-}")"
    } > "${ONDEMAND_CACHE_FILE}.env.tmp" 2>/dev/null && mv "${ONDEMAND_CACHE_FILE}.env.tmp" "${ONDEMAND_CACHE_FILE}.env"
}

# ---------------------------------------------------------------------------
# ondemand_radio_fetch
# Run the relocated L1-adjacent / data-plane reads via qcmd, parse them into the
# t2_*/lte_ta/nr_ta shell vars, and persist to ONDEMAND_CACHE_FILE.
#
# RAT-gate hardening: mimo_layers crashes the firmware in the wrong RAT
# (lte_mimo_layers in SA, nr5g_mimo_layers in LTE/NSA). We re-read the serving
# cell FIRST (fresh, not cached) to learn the current RAT, then only issue the
# mode-appropriate mimo read. If the RAT is unknown / transitioning, we SKIP the
# mimo read entirely rather than issue it blindly. time_advance, CGCONTRDP and
# QMAP="WWAN" are mode-independent and always safe to read.
#
# Loads last-known values first so a partial/skipped read (e.g. mimo skipped
# during a RAT transition) does not blank a previously-good display value.
#
# Returns 0 if any AT response was received, 1 if the modem was entirely
# unreachable.
# ---------------------------------------------------------------------------
ondemand_radio_fetch() {
    # Start from last-known so a skipped/empty sub-read keeps the prior value.
    load_ondemand_cache

    local rat_now
    rat_now=""

    # --- Fresh RAT read (gates mimo) ---------------------------------------
    local sc_result
    sc_result=$(qcmd 'AT+QENG="servingcell"' 2>/dev/null)
    if [ -n "$sc_result" ]; then
        # parse_serving_cell sets network_type (5G-SA / 5G-NSA / LTE / "")
        local _prev_nt
        _prev_nt="$network_type"
        parse_serving_cell "$sc_result"
        rat_now="$network_type"
        # Restore the caller's network_type if we learned nothing new (avoid
        # leaking a transient empty RAT into a long-lived poller var).
        [ -z "$rat_now" ] && network_type="$_prev_nt"
    fi

    # --- Group 1: APN + WAN IPs (always safe, mode-independent) -------------
    local g1
    g1=$(qcmd 'AT+CGCONTRDP;+QMAP="WWAN"' 2>/dev/null)
    if [ -n "$g1" ]; then
        if printf '%s\n' "$g1" | grep -q '+CGCONTRDP:'; then
            parse_cgcontrdp "$g1"
        fi
        if printf '%s\n' "$g1" | grep -q '+QMAP:'; then
            parse_wan_ip "$g1"
        fi
    fi

    # --- Group 2: NR timing + (SA-only) NR MIMO ----------------------------
    local nr_cmd
    nr_cmd='AT+QNWCFG="nr5g_time_advance"'
    if [ "$rat_now" = "5G-SA" ]; then
        nr_cmd="${nr_cmd}"';+QNWCFG="nr5g_mimo_layers"'
    fi
    local g2
    g2=$(qcmd "$nr_cmd" 2>/dev/null)
    if [ -n "$g2" ]; then
        parse_time_advance "$g2"
        parse_mimo "" "$g2"
    fi

    # --- Group 3: LTE timing + (LTE/NSA-only) LTE MIMO ---------------------
    local lte_cmd
    lte_cmd='AT+QNWCFG="lte_time_advance"'
    if [ "$rat_now" = "LTE" ] || [ "$rat_now" = "5G-NSA" ]; then
        lte_cmd="${lte_cmd}"';+QNWCFG="lte_mimo_layers"'
    fi
    local g3
    g3=$(qcmd "$lte_cmd" 2>/dev/null)
    if [ -n "$g3" ]; then
        parse_time_advance "$g3"
        parse_mimo "$g3" ""
    fi

    if [ -z "$sc_result" ] && [ -z "$g1" ] && [ -z "$g2" ] && [ -z "$g3" ]; then
        qlog_warn "ondemand_radio_fetch: modem unreachable (no AT responses)"
        return 1
    fi

    _ondemand_write_cache
    qlog_debug "ondemand_radio_fetch: rat=$rat_now mimo=$t2_mimo lte_ta=$lte_ta nr_ta=$nr_ta apn=$t2_apn"
    return 0
}

# ---------------------------------------------------------------------------
# ondemand_dataplane_refresh
# Refresh ONLY the safe, mode-independent data-plane group (APN / DNS / WAN IP)
# into the on-demand cache. Deliberately issues NO mimo / time_advance / L1
# read — it is meant to be called by APN / profile apply paths right after a
# COPS re-register, when the radio is mid-attach and an L1 read would be exactly
# the dangerous moment this whole change avoids. CGCONTRDP and QMAP="WWAN" are
# QCMAP/PDP reads, safe in any RAT and not L1 measurements.
#
# Loads last-known first so the mimo / TA fields the apply does NOT touch are
# preserved in the rewritten cache file.
#
# Returns 0 if the data-plane read returned anything, 1 otherwise.
# ---------------------------------------------------------------------------
ondemand_dataplane_refresh() {
    load_ondemand_cache

    local dp
    dp=$(qcmd 'AT+CGCONTRDP;+QMAP="WWAN"' 2>/dev/null)
    if [ -z "$dp" ]; then
        qlog_warn "ondemand_dataplane_refresh: no AT response"
        return 1
    fi

    if printf '%s\n' "$dp" | grep -q '+CGCONTRDP:'; then
        parse_cgcontrdp "$dp"
    fi
    if printf '%s\n' "$dp" | grep -q '+QMAP:'; then
        parse_wan_ip "$dp"
    fi

    _ondemand_write_cache
    qlog_debug "ondemand_dataplane_refresh: apn=$t2_apn wan4=$t2_wan_ipv4"
    return 0
}
