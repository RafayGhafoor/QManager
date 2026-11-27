#!/bin/sh
# t_l1.sh - l1_stats.sh: reply parsing, accumulation, gating and pacing.
HT_NAME="t_l1"
. "${HT_HERE:-$(cd "$(dirname "$0")" && pwd)}/lib.sh"
ht_stubs
_AT_BUSY=0
_QRAW=""
_QERR=""
HT_CALLS=0
HT_LAST_CMD=""
HT_ALL_CMDS=""
FAKE_RC=0
FAKE_RAW=""
_qc_read() {
    HT_CALLS=$((HT_CALLS + 1))
    HT_LAST_CMD="$1"
    HT_ALL_CMDS="${HT_ALL_CMDS}|$1"
    _QRAW=""; _QERR=""
    if [ "$FAKE_RC" -eq 0 ]; then _QRAW="$FAKE_RAW"; else _QERR="ERROR: modem_busy"; fi
    return "$FAKE_RC"
}
. "$HT_LIB/l1_stats.sh"
rd() { cat "$HT_FIX/$1"; }
cycle() { # advance a 2 s cycle: _NOW/_MONO_TOP
    _NOW=$((_NOW + 2)); _MONO_TOP=$((_MONO_TOP + 2))
}

# --- parsing: measured NSA reply -------------------------------------------------
_l1_parse "$(rd l1_nsa.txt)"
eq "lte mcs" "$_L1_P_LMCS" 5
eq "lte ri" "$_L1_P_LRI" 0
eq "lte prb" "$_L1_P_LPRB" 6
eq "lte ul mcs" "$_L1_P_LUL" 29
eq "nr mcs" "$_L1_P_NMCS" 1
eq "nr ri" "$_L1_P_NRI" 1
eq "nr cqi" "$_L1_P_NCQI" 15
eq "nr prb" "$_L1_P_NPRB" 2
eq "nr ul mcs" "$_L1_P_NUL" 25
eq "up (bits/s)" "$_L1_P_UP" 96672
eq "down (bits/s)" "$_L1_P_DL" 299388
_l1_parse "$(rd l1_lte.txt)"
eq "lte-only: no NR values" "${_L1_P_NMCS}${_L1_P_NRI}${_L1_P_NPRB}${_L1_P_NUL}" ""
eq "lte-only lte mcs" "$_L1_P_LMCS" 5
eq "lte-only down" "$_L1_P_DL" 299388
_l1_parse "$(rd l1_sa.txt)"
eq "sa: no LTE values" "${_L1_P_LMCS}${_L1_P_LRI}${_L1_P_LPRB}${_L1_P_LUL}" ""
eq "sa nr prb" "$_L1_P_NPRB" 2

# reporting off (first field 0), garbage, leading zeros, huge numbers
_l1_parse '+QNWCFG: "lte_csi_ext",0,5,0,13,0,18,6,2
+QNWCFG: "nr5g_csi_ext",0,1,1,15,7,12,2,0
+QNWCFG: "nr5g_ulMCS",0,25,4
+QNWCFG: "up/down",abc,12,2'
eq "reporting off -> nothing recorded" "${_L1_P_LMCS}${_L1_P_NMCS}${_L1_P_NUL}${_L1_P_UP}${_L1_P_DL}" ""
_l1_parse '+QNWCFG: "lte_csi_ext",1,05,00,13,0,18,007,2
+QNWCFG: "up/down",0012,000000300,2'
eq "leading zeros stripped (mcs)" "$_L1_P_LMCS" 5
eq "leading zeros stripped (ri 00 -> 0)" "$_L1_P_LRI" 0
eq "leading zeros stripped (prb)" "$_L1_P_LPRB" 7
eq "up zeros" "$_L1_P_UP" 12
eq "down zeros" "$_L1_P_DL" 300
_l1_parse '+QNWCFG: "lte_csi_ext",1,99999,-1,x,0,1,12345678,2
+QNWCFG: "up/down",1234567890123,5,2'
eq "oversized mcs rejected" "$_L1_P_LMCS" ""
eq "negative ri rejected" "$_L1_P_LRI" ""
eq "oversized prb rejected" "$_L1_P_LPRB" ""
eq "oversized up/down rejected" "${_L1_P_UP}${_L1_P_DL}" ""
_l1_parse "ERROR"
eq "ERROR reply parses to nothing" "${_L1_P_LMCS}${_L1_P_DL}" ""

# --- accumulation ----------------------------------------------------------------
network_type="5G-NSA"
l1_accum_reset
L1_ENABLED=1
_l1_parse "$(rd l1_nsa.txt)"; _l1_accum
_l1_parse '+QNWCFG: "lte_csi_ext",1,6,2,13,0,18,6,2
+QNWCFG: "nr5g_csi_ext",1,2,3,13,7,12,8,0
+QNWCFG: "nr5g_ulMCS",1,20,4
+QNWCFG: "up/down",100000,500000,2'; _l1_accum
l1_row_get
eq "mean lte mcs (5,6) rounds up" "$L1R_LMCS" 6
eq "max lte ri" "$L1R_LRI" 2
eq "last lte ul mcs (kept from sample 1)" "$L1R_LUL" 29
eq "mean nr mcs (1,2)" "$L1R_NMCS" 2
eq "max nr ri" "$L1R_NRI" 3
eq "mean nr cqi (15,13)" "$L1R_NCQI" 14
eq "last nr ul mcs" "$L1R_NUL" 20
eq "prb is the NR carrier in NSA: mean (2,8)" "$L1R_PRBM" 5
eq "prb max" "$L1R_PRBX" 8
eq "prb n" "$L1R_PRBN" 2
eq "dl mean bits/s" "$L1R_DL" 399694
eq "ul mean bits/s" "$L1R_UL" 98336
network_type="LTE"
l1_accum_reset
_l1_parse "$(rd l1_lte.txt)"; _l1_accum
l1_row_get
eq "prb is the LTE carrier in LTE" "$L1R_PRBM" 6
l1_accum_reset
l1_row_get
eq "empty window: every column null" "${L1R_LMCS}${L1R_LRI}${L1R_NMCS}${L1R_PRBM}${L1R_PRBN}${L1R_DL}${L1R_UL}" nullnullnullnullnullnullnull
L1_ENABLED=0
l1_accum_reset; network_type="LTE"; _l1_parse "$(rd l1_lte.txt)"; _l1_accum
l1_row_get
eq "disabled: row columns null even with data" "$L1R_LMCS$L1R_DL" nullnull

# --- gating and pacing ------------------------------------------------------------
reset_gate() {
    l1_accum_reset
    _L1_PREV_NET=""; _L1_PREV_PCI=""; _L1_STABLE=0; _L1_LAST_CLK=0; _L1_SKIP_MIN=""
    _L1_ERR_STREAK=0; _L1_BACKOFF_UNTIL=0; _L1_DL_BPS=0; _L1_IFACE=none
    HT_CALLS=0; HT_ALL_CMDS=""; FAKE_RC=0; _AT_BUSY=0; _QENG_PARSED=1
    _NOW=1795780800; _MONO_TOP=5000
}
L1_ENABLED=1
network_type="5G-NSA"; lte_pci=104; nr_pci=47; ap_tier="active"

reset_gate; FAKE_RAW="$(rd l1_nsa.txt)"
l1_sample 0
eq "first AT cycle: identity not yet seen twice -> no exchange" "$HT_CALLS" 0
cycle; l1_sample 0
eq "second cycle, same cell, no traffic -> one exchange" "$HT_CALLS" 1
cycle; l1_sample 0
eq "no traffic: only one exchange per row window" "$HT_CALLS" 1
case "$HT_LAST_CMD" in *mimo*) ht_bad "mimo_layers must never be read" ;; *) ht_ok ;; esac
eq "NSA command" "$HT_LAST_CMD" 'AT+QNWCFG="lte_csi_ext";+QNWCFG="nr5g_csi_ext";+QNWCFG="nr5g_ulMCS";+QNWCFG="lte_ulMCS";+QNWCFG="up/down"'

# traffic present, active tier: one per 6 s
reset_gate; FAKE_RAW="$(rd l1_nsa.txt)"; _L1_DL_BPS=5000000
l1_sample 0; cycle; l1_sample 0
eq "traffic: first exchange" "$HT_CALLS" 1
cycle; l1_sample 0
eq "traffic: 2 s later no exchange" "$HT_CALLS" 1
cycle; l1_sample 0
eq "traffic: 4 s later no exchange" "$HT_CALLS" 1
cycle; l1_sample 0
eq "traffic: 6 s later exchange" "$HT_CALLS" 2

# idle: two back-to-back under traffic, one without
reset_gate; ap_tier="idle"; FAKE_RAW="$(rd l1_nsa.txt)"; _L1_DL_BPS=5000000
l1_sample 0; cycle; l1_sample 0
eq "idle + traffic: two back-to-back" "$HT_CALLS" 2
reset_gate; ap_tier="idle"; FAKE_RAW="$(rd l1_nsa.txt)"
l1_sample 0; cycle; l1_sample 0
eq "idle, no traffic: one" "$HT_CALLS" 1

# deep: only in the row-due cycle, three back-to-back
reset_gate; ap_tier="deep"; FAKE_RAW="$(rd l1_nsa.txt)"
l1_sample 1; cycle; l1_sample 0
eq "deep, row not due -> none" "$HT_CALLS" 0
cycle; l1_sample 1
eq "deep, row due -> three back-to-back" "$HT_CALLS" 3

# identity change drops the burst and waits a cycle
reset_gate; ap_tier="active"; FAKE_RAW="$(rd l1_nsa.txt)"
l1_sample 0; cycle; l1_sample 0
l1_row_get; eq "burst collected" "$L1R_PRBN" 1
lte_pci=105; cycle; l1_sample 0
l1_row_get; eq "PCI change drops the burst" "$L1R_PRBN" null
eq "PCI change: no exchange that cycle" "$HT_CALLS" 1
cycle; l1_sample 0
eq "next cycle, new cell now stable -> exchange" "$HT_CALLS" 2
lte_pci=104
network_type="5G-SA"; nr_pci=47; cycle; l1_sample 0; cycle; l1_sample 0
case "$HT_LAST_CMD" in 'AT+QNWCFG="nr5g_csi_ext";+QNWCFG="nr5g_ulMCS";+QNWCFG="up/down"') ht_ok ;; *) ht_bad "SA command" "$HT_LAST_CMD" ;; esac
network_type="LTE"; cycle; l1_sample 0; cycle; l1_sample 0
case "$HT_LAST_CMD" in 'AT+QNWCFG="lte_csi_ext";+QNWCFG="lte_ulMCS";+QNWCFG="up/down"') ht_ok ;; *) ht_bad "LTE command" "$HT_LAST_CMD" ;; esac
case "$HT_ALL_CMDS" in *mimo*) ht_bad "a *_mimo_layers command was issued" "$HT_ALL_CMDS" ;; *) ht_ok ;; esac
network_type="5G-NSA"

# gates: QENG did not parse, disabled, busy
reset_gate; _QENG_PARSED=0; FAKE_RAW="$(rd l1_nsa.txt)"
l1_sample 0; cycle; l1_sample 0
eq "QENG not parsed -> no exchange" "$HT_CALLS" 0
reset_gate; L1_ENABLED=0; FAKE_RAW="$(rd l1_nsa.txt)"
l1_sample 0; cycle; l1_sample 0
eq "disabled -> no exchange" "$HT_CALLS" 0
L1_ENABLED=1
reset_gate; FAKE_RAW="$(rd l1_nsa.txt)"; _AT_BUSY=1
l1_sample 0; cycle; l1_sample 0
eq "latched busy cycle -> no exchange" "$HT_CALLS" 0
reset_gate; FAKE_RC=3; l1_sample 0; cycle; l1_sample 0
eq "busy reply: one attempt" "$HT_CALLS" 1
cycle; l1_sample 0
eq "busy reply abandons the rest of the minute" "$HT_CALLS" 1
_NOW=$((_NOW + 120)); _MONO_TOP=$((_MONO_TOP + 120)); FAKE_RC=0; FAKE_RAW="$(rd l1_nsa.txt)"
l1_sample 0; cycle; l1_sample 0
eq "a later minute samples again" "$HT_CALLS" 2

# repeated failures back off
reset_gate; FAKE_RAW="ERROR"
l1_sample 0
i=0; while [ "$i" -lt 8 ]; do cycle; l1_sample 0; i=$((i + 1)); done
eq "three ERROR replies then a pause" "$HT_CALLS" 3
_NOW=$((_NOW + 700)); _MONO_TOP=$((_MONO_TOP + 700)); FAKE_RAW="$(rd l1_nsa.txt)"
l1_sample 0; cycle; l1_sample 0
yes "sampling resumes after the pause" test "$HT_CALLS" -gt 3

# netdev gate: interface probe order and the rate from the counter delta
rm -rf "$HT_TMP/sys"; mkdir -p "$HT_TMP/sys/rmnet_mhi0/statistics"
L1_SYS_NET="$HT_TMP/sys"; DU_IFACE=rmnet_ipa0
reset_gate; _L1_IFACE=""; _L1_RX_PREV=""; _L1_DL_BPS=0
printf '1000000\n' > "$HT_TMP/sys/rmnet_mhi0/statistics/rx_bytes"
_MONO_TOP=100; _l1_netdev
eq "falls through to the first readable interface" "$_L1_IFACE" rmnet_mhi0
eq "first read sets no rate" "$_L1_DL_BPS" 0
printf '3500000\n' > "$HT_TMP/sys/rmnet_mhi0/statistics/rx_bytes"
_MONO_TOP=102; _l1_netdev
eq "2.5 MB in 2 s = 10 Mbit/s" "$_L1_DL_BPS" 10000000
printf '100\n' > "$HT_TMP/sys/rmnet_mhi0/statistics/rx_bytes"
_MONO_TOP=106; _l1_netdev
eq "counter that went backwards reads as no traffic" "$_L1_DL_BPS" 0
printf '9999999\n' > "$HT_TMP/sys/rmnet_mhi0/statistics/rx_bytes"
_MONO_TOP=107; _l1_netdev
eq "under 2 s since the last read: rate not recomputed" "$_L1_DL_BPS" 0
yes "isnum accepts counters" _l1_isnum 8680958332 18
no "isnum rejects text" _l1_isnum 12ab 18
rm -rf "$HT_TMP/sys"

ht_done
