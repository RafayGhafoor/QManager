#!/bin/sh
# shim.sh - shared by dump_globals.sh and tap_replay.sh.
# Stubs the qlog_* API, defines the poller-shaped call wrappers, and the
# sentinel / poller-default initialisers. All harness names use the PP_/pp_
# prefix so they can never match the `set | grep` global filter.

qlog_debug() { :; }
qlog_info() { :; }
qlog_warn() { :; }
qlog_error() { :; }
qlog_state_change() { :; }

# Globals the parsers may write (the names the poller initialises, minus the
# non-parser ones). _cid_* are not initialised by the poller (left unset).
PP_NAMES="lte_state lte_band lte_earfcn lte_bandwidth lte_pci lte_rsrp lte_rsrq lte_sinr lte_rssi lte_cell_id lte_enodeb_id lte_sector_id lte_tac lte_ta nr_state nr_band nr_arfcn nr_cell_id nr_enodeb_id nr_sector_id nr_tac nr_pci nr_rsrp nr_rsrq nr_sinr nr_scs nr_ta t1_temperature t2_carrier t2_sim_status t2_sim_slot t2_ca_active t2_ca_count t2_nr_ca_active t2_nr_ca_count t2_total_bandwidth_mhz t2_bandwidth_details t2_carrier_components sig_lte_rsrp sig_lte_rsrq sig_lte_sinr sig_nr_rsrp sig_nr_rsrq sig_nr_sinr network_type service_status"

# pp_init_sentinels: every name -> SENT_<name>, so "parser left it alone" shows.
pp_init_sentinels() {
    for PP_N in $PP_NAMES; do
        eval "$PP_N=SENT_$PP_N"
    done
}

# pp_init_defaults: the real values from the poller's global init block.
pp_init_defaults() {
    t1_temperature=""
    t2_carrier="" ; t2_sim_status="" ; t2_sim_slot="1"
    t2_ca_active=false ; t2_ca_count=0 ; t2_nr_ca_active=false ; t2_nr_ca_count=0
    t2_total_bandwidth_mhz=0 ; t2_bandwidth_details="" ; t2_carrier_components="[]"
    lte_state="unknown" ; lte_band="" ; lte_earfcn="" ; lte_bandwidth="" ; lte_pci=""
    lte_rsrp="" ; lte_rsrq="" ; lte_sinr="" ; lte_rssi=""
    lte_cell_id="" ; lte_enodeb_id="" ; lte_sector_id="" ; lte_tac=""
    nr_state="unknown" ; nr_band="" ; nr_arfcn="" ; nr_cell_id="" ; nr_enodeb_id=""
    nr_sector_id="" ; nr_tac="" ; nr_pci="" ; nr_rsrp="" ; nr_rsrq="" ; nr_sinr="" ; nr_scs=""
    lte_ta="" ; nr_ta=""
    network_type="" ; service_status="unknown"
    sig_lte_rsrp="[null,null,null,null]" ; sig_lte_rsrq="[null,null,null,null]"
    sig_lte_sinr="[null,null,null,null]" ; sig_nr_rsrp="[null,null,null,null]"
    sig_nr_rsrq="[null,null,null,null]" ; sig_nr_sinr="[null,null,null,null]"
}

# pp_qx <raw> [rc]: the qcmd_exec filter (qmanager_poller qcmd_exec()).
# Sets PP_RC (0 ok, 1 failed/empty, 2 contains ERROR) and PP_OUT (stripped).
# NOTE the poller strips with grep -v '^AT' / '^OK$' / '^$' on CRLF data, so
# "OK\r" and "\r" lines SURVIVE the strip; the pipeline is reproduced verbatim.
pp_qx() {
    PP_OUT=""
    PP_RC=${2:-0}
    if [ "$PP_RC" -ne 0 ] || [ -z "$1" ]; then
        PP_RC=1
        return 0
    fi
    PP_OUT=$(printf '%s\n' "$1" | grep -v '^AT' | grep -v '^OK$' | grep -v '^$')
    case "$PP_OUT" in
        *ERROR*) PP_RC=2 ;;
    esac
    return 0
}

# poll_serving_cell shape. Failure branch only replicates the lte/nr_state reset.
pp_call_serving_cell() {
    pp_qx "$1" "$2"
    if [ "$PP_RC" -eq 0 ] || [ "$PP_RC" -eq 2 ]; then
        parse_serving_cell "$PP_OUT"
    else
        lte_state="unknown"
        nr_state="unknown"
    fi
}

# Tier-1 QCAINFO shape (poller main loop): parse only when rc==0 and non-empty,
# otherwise the reset block.
pp_call_ca_info() {
    pp_qx "$1" "$2"
    if [ "$PP_RC" -eq 0 ] && [ -n "$PP_OUT" ]; then
        parse_ca_info "$PP_OUT"
    else
        t2_ca_active=false
        t2_ca_count=0
        t2_nr_ca_active=false
        t2_nr_ca_count=0
        t2_total_bandwidth_mhz=0
        t2_bandwidth_details=""
        t2_carrier_components="[]"
    fi
}

# poll_per_antenna_signal shape: raw qcmd output, parsers only when non-empty.
pp_call_signal() {
    if [ -n "$1" ]; then
        parse_qrsrp "$1"
        parse_qrsrq "$1"
        parse_qsinr "$1"
    fi
}

pp_call_qrsrp() { [ -n "$1" ] && parse_qrsrp "$1"; return 0; }
pp_call_qrsrq() { [ -n "$1" ] && parse_qrsrq "$1"; return 0; }
pp_call_qsinr() { [ -n "$1" ] && parse_qsinr "$1"; return 0; }

# poll_tier2 shape: raw (unstripped) compound reply -> carrier, slot, CPIN line.
pp_call_tier2() {
    if [ -n "$1" ]; then
        parse_carrier "$1"
        parse_sim_slot "$1"
        PP_CPIN=$(printf '%s\n' "$1" | grep '+CPIN:' | head -1)
        if [ -n "$PP_CPIN" ]; then
            parse_sim_status "$PP_CPIN"
        elif printf '%s\n' "$1" | grep -q 'CME ERROR'; then
            t2_sim_status="error"
        fi
    fi
}

# Individual tier-2 pieces (same pre-processing as pp_call_tier2).
pp_call_carrier() { [ -n "$1" ] && parse_carrier "$1"; return 0; }
pp_call_sim_slot() { [ -n "$1" ] && parse_sim_slot "$1"; return 0; }
pp_call_sim_status() {
    [ -n "$1" ] || return 0
    PP_CPIN=$(printf '%s\n' "$1" | grep '+CPIN:' | head -1)
    if [ -n "$PP_CPIN" ]; then
        parse_sim_status "$PP_CPIN"
    elif printf '%s\n' "$1" | grep -q 'CME ERROR'; then
        t2_sim_status="error"
    fi
    return 0
}

# pp_source_lib <path>: source a parse_at.sh. Any /tmp/qmanager_*.tmp scratch
# path inside it is rewritten to a private name so a harness run on the device
# can never collide with the live poller's parse_ca_info temp files.
# PARITY_NO_TMP_REWRITE=1 disables the rewrite (source the file as-is).
pp_source_lib() {
    if [ -n "$PARITY_NO_TMP_REWRITE" ]; then
        . "$1"
        return 0
    fi
    PP_COPY="${TMPDIR:-/tmp}/ppx_lib_$$.sh"
    sed "s#/tmp/qmanager_\([A-Za-z0-9_]*\.tmp\)#/tmp/ppx_$$_\1#g" "$1" > "$PP_COPY"
    . "$PP_COPY"
    rm -f "$PP_COPY" "/tmp/ppx_$$_cc_data.tmp" "/tmp/ppx_$$_ca_parse.tmp"
}

# pp_diff <old> <new>: readable difference (the device BusyBox has no diff
# applet). Uses diff -u when present, else a line-set difference ("-" only in
# old, "+" only in new). CR bytes are shown as <CR>.
pp_diff() {
    PP_CRC=$(printf '\r')
    if command -v diff >/dev/null 2>&1; then
        diff -u "$1" "$2" | sed "s/$PP_CRC/<CR>/g"
        return 0
    fi
    grep -vxF -f "$2" "$1" | sed "s/$PP_CRC/<CR>/g; s/^/- /"
    grep -vxF -f "$1" "$2" | sed "s/$PP_CRC/<CR>/g; s/^/+ /"
    return 0
}
