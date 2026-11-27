#!/bin/sh
# qeng_l1_expect.sh <parse_at.sh>
#
# Table test for the history recorder's two free AT+QENG readings, qe_lte_cqi
# (LTE <CQI>) and qe_lte_txp (UE tx power, raw 0.1 dBm), in BOTH LTE layouts:
#   NSA  +QENG: "LTE","FDD",mcc,mnc,cellID,PCID,earfcn,band,UL_bw,DL_bw,TAC,RSRP,RSRQ,RSSI,SINR,CQI,tx_power,srxlev
#                  fields 15 SINR, 16 CQI, 17 tx_power
#   LTE  +QENG: "servingcell",state,"LTE","FDD",mcc,mnc,cellID,PCID,earfcn,band,UL_bw,DL_bw,TAC,RSRP,RSRQ,RSSI,SINR,CQI,tx_power,srxlev
#                  fields 17 SINR, 18 CQI, 19 tx_power
# They are not lte_-prefixed on purpose: parity.sh's dump matches ^lte_ and an old
# library never sets them, so adding them to the dump would fail every serving-cell
# fixture. Also asserts the neighbours (lte_sinr, lte_rssi) are unchanged.
# Run under the device's BusyBox ash. Exit 0 only if every row matches.

LIB=$1
[ -f "$LIB" ] || { echo "usage: qeng_l1_expect.sh <parse_at.sh>" >&2; exit 2; }
qlog_debug() { :; } ; qlog_info() { :; } ; qlog_warn() { :; } ; qlog_error() { :; }
. "$LIB"

CR=$(printf '\r')
pass=0
fail=0

# row <name> <reply> <cqi> <txp> <sinr> <rssi>
row() {
    qe_lte_cqi=SENT; qe_lte_txp=SENT
    parse_serving_cell "$2"
    if [ "$qe_lte_cqi" = "$3" ] && [ "$qe_lte_txp" = "$4" ] && [ "$lte_sinr" = "$5" ] && [ "$lte_rssi" = "$6" ]; then
        pass=$((pass + 1))
    else
        printf 'FAIL %s: cqi=[%s] txp=[%s] sinr=[%s] rssi=[%s]  want [%s] [%s] [%s] [%s]\n' \
            "$1" "$qe_lte_cqi" "$qe_lte_txp" "$lte_sinr" "$lte_rssi" "$3" "$4" "$5" "$6"
        fail=$((fail + 1))
    fi
}

SC='+QENG: "servingcell","NOCONN"'
# NSA layout. The first row is a verbatim capture (RM551E, 2026-11-27).
row nsa_live      "$SC
+QENG: \"LTE\",\"FDD\",410,01,2E38917,104,250,1,3,3,D857,-75,-11,-46,12,10,-110,-
+QENG: \"NR5G-NSA\",410,01,47,-58,30,-10,509070,41,7,1" 10 -110 4 -46
row nsa_positive  "$SC
+QENG: \"LTE\",\"FDD\",410,01,2E38917,104,250,1,3,3,D857,-75,-11,-46,12,11,150,-
+QENG: \"NR5G-NSA\",410,01,47,-58,30,-10,509070,41,7,1" 11 150 4 -46
row nsa_cqi0      "$SC
+QENG: \"LTE\",\"FDD\",410,01,2E38917,104,250,1,3,3,D857,-75,-11,-46,12,0,150,-
+QENG: \"NR5G-NSA\",515,03,271,-95,12,-11,504990,78,1,1" 0 150 4 -46
row nsa_dashes    "$SC
+QENG: \"LTE\",\"FDD\",410,01,2E38917,104,250,1,3,3,D857,-75,-11,-46,12,-,-,-
+QENG: \"NR5G-NSA\",515,03,271,-95,12,-11,504990,78,1,1" "" "" 4 -46
row nsa_15fields  "$SC
+QENG: \"LTE\",\"FDD\",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9$CR
+QENG: \"NR5G-NSA\",515,03,271,-95,12,-11,504990,78,1,1" "" "" -2 -63
row nsa_16fields  "$SC
+QENG: \"LTE\",\"FDD\",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,7$CR
+QENG: \"NR5G-NSA\",515,03,271,-95,12,-11,504990,78,1,1" 7 "" -2 -63
row nsa_17_cr     "$SC
+QENG: \"LTE\",\"FDD\",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,7,-35$CR
+QENG: \"NR5G-NSA\",515,03,271,-95,12,-11,504990,78,1,1" 7 -35 -2 -63
row nsa_garbage   "$SC
+QENG: \"LTE\",\"FDD\",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,1x,3-5,-
+QENG: \"NR5G-NSA\",515,03,271,-95,12,-11,504990,78,1,1" "" "" -2 -63
row nsa_leading0  "$SC
+QENG: \"LTE\",\"FDD\",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,07,-0,-
+QENG: \"NR5G-NSA\",515,03,271,-95,12,-11,504990,78,1,1" 7 -0 -2 -63
row nsa_toolong   "$SC
+QENG: \"LTE\",\"FDD\",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,123,12345,-
+QENG: \"NR5G-NSA\",515,03,271,-95,12,-11,504990,78,1,1" "" "" -2 -63
# LTE-only layout (one servingcell line).
row lte_fdd       '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,0,240,-' 0 240 -2 -63
row lte_connect   '+QENG: "servingcell","CONNECT","LTE","TDD",515,03,2D1AB04,271,40540,41,5,5,A1B2,-95,-9,-65,15,10,150,-' 10 150 10 -65
row lte_negative  '+QENG: "servingcell","CONNECT","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,12,-35,-' 12 -35 -2 -63
row lte_dashes    '+QENG: "servingcell","CONNECT","LTE","FDD",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,-,-,-' "" "" -2 -63
row lte_17fields  "+QENG: \"servingcell\",\"NOCONN\",\"LTE\",\"FDD\",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9$CR" "" "" -2 -63
row lte_19fields_cr "+QENG: \"servingcell\",\"NOCONN\",\"LTE\",\"FDD\",515,03,2D1AB04,271,1300,3,5,5,A1B2,-92,-9,-63,9,6,80$CR" 6 80 -2 -63
# Not LTE: nothing recorded, and nothing left over from a previous sample.
row sa_no_lte     '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,2D1AB04A1,271,1A2B,504990,78,1,-95,-11,12,1,-' "" "" "" ""
row nsa_no_lte_line "$SC
+QENG: \"NR5G-NSA\",515,03,271,-95,12,-11,504990,78,1,1" "" "" "" ""
row no_qeng_lines 'ERROR' "" "" "" ""
# A previous sample must not leak into the next reading.
qe_lte_cqi=9; qe_lte_txp=100
parse_serving_cell "$SC"
if [ "$qe_lte_cqi$qe_lte_txp" = "" ]; then pass=$((pass + 1)); else echo "FAIL stale values survived a reply with no LTE line: [$qe_lte_cqi][$qe_lte_txp]"; fail=$((fail + 1)); fi

echo "qeng_l1_expect: pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
