#!/bin/sh
# t_row.sh - append_cell_history: the v2 row from REAL captured replies run
# through the real parsers, plus NOSVC, SA, LTE, no-carrier fallback and gating.
HT_NAME="t_row"
. "${HT_HERE:-$(cd "$(dirname "$0")" && pwd)}/lib.sh"
ht_stubs
. "$HT_LIB/parse_at.sh"
. "$HT_LIB/history_store.sh"
. "$HT_LIB/l1_stats.sh"
ht_load_poller_fns

CELL_HISTORY_DIR="$HT_TMP/row/cell_history"
CELL_HISTORY_STATE="$HT_TMP/row/state"
rm -rf "$HT_TMP/row"; mkdir -p "$HT_TMP/row"
rd() { cat "$HT_FIX/$1"; }
# qcmd_exec_g's strip: drop lines starting with AT and lines that are exactly OK.
strip() {
    _o="$IFS"; IFS="$_NL"; set -f; set -- $1; set +f; IFS="$_o"
    _s=""
    for _l; do case "$_l" in AT*|OK) continue ;; esac; _s="${_s:+${_s}${_NL}}${_l}"; done
    printf '%s' "$_s"
}
reset_state() {
    lte_state=unknown; nr_state=unknown; network_type=""
    lte_band=""; lte_earfcn=""; lte_bandwidth=""; lte_pci=""; lte_rsrp=""; lte_rsrq=""; lte_sinr=""; lte_rssi=""
    lte_cell_id=""; lte_tac=""; nr_band=""; nr_arfcn=""; nr_pci=""; nr_rsrp=""; nr_rsrq=""; nr_sinr=""; nr_scs=""
    nr_cell_id=""; nr_tac=""
    t2_carrier_components="[]"; t2_ca_count=0; t2_nr_ca_count=0
    sig_lte_rsrp="[null,null,null,null]"; sig_nr_rsrp="[null,null,null,null]"
    t1_temperature=45; cpu_usage=30; memory_used_mb=102; memory_total_mb=255
    modem_reachable=true; _QENG_PARSED=1; _QENG_LINES=1; ap_tier=active
    qe_lte_cqi=""; qe_lte_txp=""
    _ch_last_ts=0; _ch_maint_day=""; _ch_next_maint=0; _ch_ok=1; _ch_dir_ok=0
    L1_ENABLED=0; l1_accum_reset
    rm -rf "$CELL_HISTORY_DIR"
}
last_row() { tail -n 1 "$CELL_HISTORY_DIR/$(ls "$CELL_HISTORY_DIR" | sort | tail -n 1)"; }
ncols() { # head columns of a v2 row (stops before the first carrier array)
    printf '%s' "$1" | sed 's/,\[".*$//; s/^\[//; s/\]$//' | awk -F, '{ print NF }'
}

# --- NSA: real captured replies, L1 enabled ----------------------------------------
reset_state
NOW=$(ht_epoch 2026-11-27 12:00:07)
_NOW="$NOW"; _MONO_TOP=5000
parse_serving_cell "$(strip "$(rd qeng_nsa.txt)")"
parse_ca_info "$(strip "$(rd qcainfo_nsa.txt)")"
_raw="$(rd antenna_nsa.txt)"
parse_qrsrp "$_raw"
L1_ENABLED=1; network_type=5G-NSA
_l1_parse "$(rd l1_nsa.txt)"; _l1_accum
_l1_parse "$(rd l1_nsa.txt)"; _l1_accum
append_cell_history
ROW=$(last_row)
printf '%s\n' "$ROW" > "$HT_TMP/row_nsa.txt"
eq "NSA: 38 head columns" "$(ncols "$ROW")" 38
EXP='[2,1795780807,"NSA",1,"a",48466199,55383,null,null,0,1,60,10,-11.0,5,0,29,1,1,15,25,2,2,2,133,299388,96672,45,30,40,-85,-124,-118,-75,-58,-99,null,null,["P","L",1,250,10,104,-75,-10,5,-48],["S","N",41,509070,50,47,-62,-11,29.1,null]]'
eq "NSA: exact row" "$ROW" "$EXP"
if command -v jq >/dev/null 2>&1; then
    eq "NSA: valid JSON, 38 + 2 carriers" "$(printf '%s' "$ROW" | jq -c 'length')" 40
    eq "NSA: band is a number" "$(printf '%s' "$ROW" | jq -c '.[38][2], .[39][2]')" "1
41"
fi

# --- same minute: nothing more; next minute: a second row ---------------------------
append_cell_history
eq "same minute: no second row" "$(wc -l < "$CELL_HISTORY_DIR/2026-11-27.jsonl" | tr -d ' ')" 1
_NOW=$((NOW + 61)); append_cell_history
eq "next minute: second row" "$(wc -l < "$CELL_HISTORY_DIR/2026-11-27.jsonl" | tr -d ' ')" 2
eq "accumulators reset after a row (no L1 in the second row)" "$(last_row | awk -F, '{ print $15 "," $16 "," $26 }')" "null,null,null"
eq "archive state file written" "$(sed -n 's/^state=//p' "$HT_TMP/row/state")" ok

# --- L1 off: every L1 column is null but PHY-free columns stay ---------------------
reset_state
_NOW="$NOW"
parse_serving_cell "$(strip "$(rd qeng_nsa.txt)")"
parse_ca_info "$(strip "$(rd qcainfo_nsa.txt)")"
parse_qrsrp "$(rd antenna_nsa.txt)"
append_cell_history
ROW=$(last_row)
eq "L1 off: columns 15-24 and 26-27 null, n_rb and CQI/tx kept" "$(printf '%s' "$ROW" | awk -F, '{ for (i = 15; i <= 24; i++) printf "%s ", $i; print $25, $26, $27, $13, $14 }')" "null null null null null null null null null null 133 null null 10 -11.0"

# --- LTE only ------------------------------------------------------------------------
reset_state
_NOW="$NOW"
parse_serving_cell "$(strip '+QENG: "servingcell","NOCONN","LTE","FDD",410,01,2E38917,104,250,1,3,3,D857,-75,-11,-46,12,9,-95,-')"
t2_carrier_components='[{"type":"PCC","technology":"LTE","band":"B1","earfcn":250,"bandwidth_mhz":10,"pci":104,"rsrp":-75,"rsrq":-11,"rssi":-46,"sinr":4},{"type":"SCC","technology":"LTE","band":"B3","earfcn":1650,"bandwidth_mhz":20,"pci":104,"rsrp":-80,"rsrq":-9,"rssi":-50,"sinr":8}]'
parse_qrsrp "$(rd antenna_nsa.txt)"
append_cell_history
ROW=$(last_row)
eq "LTE: 38 head columns" "$(ncols "$ROW")" 38
eq "LTE: rat" "$(printf '%s' "$ROW" | awk -F, '{ print $3 "," $4 }')" '"LTE",0'
eq "LTE: scc count, nr scc, total bw" "$(printf '%s' "$ROW" | awk -F, '{ print $10 "," $11 "," $12 }')" "1,0,30"
eq "LTE: cqi 9, tx -9.5" "$(printf '%s' "$ROW" | awk -F, '{ print $13 "," $14 }')" "9,-9.5"
eq "LTE: n_rb of the 10 MHz PCC" "$(printf '%s' "$ROW" | awk -F, '{ print $25 }')" 50
eq "LTE: NR ports null even though sig_nr_rsrp held data" "$(printf '%s' "$ROW" | awk -F, '{ print $35 "," $36 "," $37 "," $38 }')" "null,null,null,null"

# --- SA ----------------------------------------------------------------------------
reset_state
_NOW="$NOW"
parse_serving_cell "$(strip '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",410,01,2D1AB04A1,271,1A2B,504990,78,1,-95,-11,12,1,-')"
t2_carrier_components='[{"type":"PCC","technology":"NR","band":"N78","earfcn":504990,"bandwidth_mhz":100,"pci":271,"rsrp":-95,"rsrq":-11,"rssi":null,"sinr":12.5}]'
append_cell_history
ROW=$(last_row)
eq "SA: 38 head columns" "$(ncols "$ROW")" 38
eq "SA: rat, nr_avail" "$(printf '%s' "$ROW" | awk -F, '{ print $3 "," $4 }')" '"SA",1'
eq "SA: nr cell id / tac present, lte null" "$(printf '%s' "$ROW" | awk -F, '{ print ($6) "," ($7) "," ($9 != "null") }')" "null,null,1"
eq "SA: n_rb 100 MHz @ 30 kHz" "$(printf '%s' "$ROW" | awk -F, '{ print $25 }')" 273
eq "SA: carrier" "$(printf '%s' "$ROW" | sed 's/^.*,\(\["P"\)/\1/')" '["P","N",78,504990,100,271,-95,-11,12.5,null]]'
eq "SA: no CQI/tx (LTE-only fields)" "$(printf '%s' "$ROW" | awk -F, '{ print $13 "," $14 }')" "null,null"

# --- NOSVC: asked, answered, nothing serving -----------------------------------------
reset_state
_NOW="$NOW"
parse_serving_cell "$(strip '+QENG: "servingcell","SEARCH"')"
append_cell_history
ROW=$(last_row)
eq "NOSVC: exact row (modem columns null, system columns kept)" "$ROW" "[2,1795780807,\"NOSVC\",null,\"a\",null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,45,30,40,null,null,null,null,null,null,null,null]"
eq "NOSVC: 38 columns" "$(printf '%s' "$ROW" | sed 's/^\[//; s/\]$//' | awk -F, '{ print NF }')" 38

# an ERROR reply parsed but carried no +QENG: line -> no row at all
reset_state
_NOW="$NOW"; _QENG_LINES=0
append_cell_history
no "ERROR reply writes nothing" test -d "$CELL_HISTORY_DIR/2026-11-27.jsonl"
eq "no file for an error reply" "$(ls "$CELL_HISTORY_DIR" 2>/dev/null | wc -l | tr -d ' ')" 0

# --- QCAINFO gave nothing: stand-in carriers from QENG --------------------------------
reset_state
_NOW="$NOW"
parse_serving_cell "$(strip "$(rd qeng_nsa.txt)")"
t2_carrier_components="[]"
append_cell_history
ROW=$(last_row)
eq "no carriers: serving cells from QENG, NR leg as S" "$(printf '%s' "$ROW" | sed 's/^.*,\(\["P"\)/\1/')" '["P","L",1,250,10,104,-75,-11,4,-46],["S","N",41,509070,null,47,-58,-10,30,null]]'
eq "no carriers: counts" "$(printf '%s' "$ROW" | awk -F, '{ print $10 "," $11 "," $12 }')" "0,1,10"

# --- hostile / torn carrier JSON never produces invalid JSON ---------------------------
reset_state
_NOW="$NOW"
parse_serving_cell "$(strip "$(rd qeng_nsa.txt)")"
t2_carrier_components='[{"type":"PCC","technology":"LTE","band":"B1\",{","earfcn":2x0,"bandwidth_mhz":10,"pci":104,"rsrp":-75,"rsrq":"-11","rssi":-46,"sinr":null},{"type":"SCC","technology":"WIFI","band":"B9"},{"type":"SCC","technology":"NR","band":"N41","earfcn":509070,"bandwidth_mhz":50,"pci":47,"rsrp":-6'
append_cell_history
ROW=$(last_row)
if command -v jq >/dev/null 2>&1; then
    if printf '%s' "$ROW" | jq -e . >/dev/null 2>&1; then ht_ok; else ht_bad "hostile carriers: row is valid JSON" "$ROW"; fi
fi

# --- gating -------------------------------------------------------------------------
reset_state
_NOW=1000; parse_serving_cell "$(strip "$(rd qeng_nsa.txt)")"
append_cell_history
eq "clock not set (1970): no row" "$(ls "$CELL_HISTORY_DIR" 2>/dev/null | wc -l | tr -d ' ')" 0
reset_state; _NOW="$NOW"; modem_reachable=false
parse_serving_cell "$(strip "$(rd qeng_nsa.txt)")"
append_cell_history
eq "modem unreachable: no row" "$(ls "$CELL_HISTORY_DIR" 2>/dev/null | wc -l | tr -d ' ')" 0
reset_state; _NOW="$NOW"; _QENG_PARSED=0
parse_serving_cell "$(strip "$(rd qeng_nsa.txt)")"
append_cell_history
eq "QENG not parsed this cycle: no row" "$(ls "$CELL_HISTORY_DIR" 2>/dev/null | wc -l | tr -d ' ')" 0

# --- low space: refused, no day latch, recovers ---------------------------------------
reset_state
_NOW="$NOW"; parse_serving_cell "$(strip "$(rd qeng_nsa.txt)")"
CELL_HISTORY_MIN_FREE_KB=999999999
append_cell_history
eq "below the floor: no row" "$(ls "$CELL_HISTORY_DIR" 2>/dev/null | grep -c jsonl)" 0
eq "below the floor: state file says low_space" "$(sed -n 's/^state=//p' "$HT_TMP/row/state")" low_space
eq "below the floor: retry scheduled an hour out" "$_ch_next_maint" $((NOW + 3600))
CELL_HISTORY_MIN_FREE_KB=0
_NOW=$((NOW + 120)); append_cell_history
eq "still inside the retry hour: still refused" "$(ls "$CELL_HISTORY_DIR" 2>/dev/null | grep -c jsonl)" 0
_NOW=$((NOW + 3601)); append_cell_history
eq "retry after the hour: archive recovers within the same UTC day" "$(ls "$CELL_HISTORY_DIR" | grep -c jsonl)" 1
eq "state back to ok" "$(sed -n 's/^state=//p' "$HT_TMP/row/state")" ok

# --- rotation: a new UTC day compresses the closed day ---------------------------------
reset_state
_NOW="$NOW"; parse_serving_cell "$(strip "$(rd qeng_nsa.txt)")"
append_cell_history
NEXT=$(ht_epoch 2026-11-28 00:00:30)
_NOW="$NEXT"; append_cell_history
yes "new day file started" test -f "$CELL_HISTORY_DIR/2026-11-28.jsonl"
yes "closed day compressed at rotation" test -f "$CELL_HISTORY_DIR/2026-11-27.jsonl.gz"
no "closed day's plain file gone" test -e "$CELL_HISTORY_DIR/2026-11-27.jsonl"

# --- _ymd against the platform's date, including leap days -----------------------------
for e in 0 951782400 1709164800 1709251200 4107542400 1795780807 1767225599 1767225600; do
    want=$(date -u -d "@$e" +%Y-%m-%d 2>/dev/null || date -u -r "$e" +%Y-%m-%d)
    _ymd "$e"
    eq "_ymd $e" "$_YMD" "$want"
done

# --- tier letter, helpers ---------------------------------------------------------------
eq "_ch_int strips zeros" "$(_ch_int 007; echo $_CI)" 7
_ch_int -0; eq "_ch_int -0" "$_CI" 0
_ch_int 1-2; eq "_ch_int rejects 1-2" "$_CI" null
_ch_int ""; eq "_ch_int empty" "$_CI" null
_ch_txp 150; eq "tx 150 -> 15.0" "$_CI" 15.0
_ch_txp -35; eq "tx -35 -> -3.5" "$_CI" -3.5
_ch_txp -5; eq "tx -5 -> -0.5" "$_CI" -0.5
_ch_txp 0; eq "tx 0 -> 0.0" "$_CI" 0.0
_ch_txp 99999; eq "tx oversized -> null" "$_CI" null
_ch_cqi 0; eq "cqi 0 -> null" "$_CI" null
_ch_cqi 16; eq "cqi 16 -> null" "$_CI" null
_ch_cqi 15; eq "cqi 15" "$_CI" 15
_ch_nrb N 20 15; eq "n_rb 20 MHz @ 15" "$_CI" 106
_ch_nrb N 50 60; eq "n_rb 50 MHz @ 60" "$_CI" 65
_ch_nrb N 100 120; eq "n_rb unknown scs -> null" "$_CI" null
_ch_nrb L 20; eq "n_rb LTE 20" "$_CI" 100
_ch_arr4 '[-85,-140,-118,null]'; eq "-140 sentinel -> null" "$_CA" "-85,null,-118,null"
_ch_arr4 '[1,2,3]'; eq "short array -> nulls" "$_CA" "null,null,null,null"
_ch_arr4 'garbage'; eq "garbage array -> nulls" "$_CA" "null,null,null,null"

rm -rf "$HT_TMP/row"
ht_done
