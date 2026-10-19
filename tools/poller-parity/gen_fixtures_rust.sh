#!/bin/sh
# gen_fixtures_rust.sh [out_dir]   (POSIX sh; device or Git Bash)
#
# Extra fixtures for the Rust parser parity (B5.29 Phase D): the steps the
# shell harness has no fixture parser for (cfun, simid), CNUM shapes for the
# ident step, BusyBox `echo` option words in per-antenna values, number
# rendering edge cases in QCAINFO, NUL and non-UTF-8 bytes. Same framing as
# gen_fixtures.sh (echo line "\r\r\n", data lines "\r\n").

OUT=${1:-${0%/*}/fixtures_rust}
mkdir -p "$OUT" || exit 1
N=0

single() {   # name echo line...
    _f="$OUT/$1.txt" ; shift ; _e=$1 ; shift
    {
        printf '%s\r\r\n' "$_e"
        for _l in "$@"; do printf '%s\r\n' "$_l"; done
        printf '\r\nOK\r\n'
    } > "$_f"
    N=$((N + 1))
}
compound() { # name echo line...
    _f="$OUT/$1.txt" ; shift ; _e=$1 ; shift
    {
        printf '%s\r\r\n' "$_e"
        for _l in "$@"; do printf '%s\r\n\r\n' "$_l"; done
        printf 'OK\r\n'
    } > "$_f"
    N=$((N + 1))
}
lfonly() {
    _f="$OUT/$1.txt" ; shift ; _e=$1 ; shift
    {
        printf '%s\n' "$_e"
        for _l in "$@"; do printf '%s\n' "$_l"; done
        printf '\nOK\n'
    } > "$_f"
    N=$((N + 1))
}
errreply() { printf '%s\r\r\n%s\r\n' "$2" "$3" > "$OUT/$1.txt"; N=$((N + 1)); }
emptyf() { : > "$OUT/$1.txt"; N=$((N + 1)); }
rawf()   { printf "$2" > "$OUT/$1.txt"; N=$((N + 1)); }

CF='AT+CFUN?'
SI='AT+CIMI;+QCCID'
T2='AT+COPS?;+QUIMSLOT?;+CNUM;+CPIN?'
QS='AT+QRSRP;+QRSRQ;+QSINR'
QC='AT+QCAINFO'
QE='AT+QENG="servingcell"'
H='$(touch /tmp/pp_pwned)'

# ------------------------------------------------------------------ cfun --
single cfun__1 "$CF" '+CFUN: 1'
single cfun__0 "$CF" '+CFUN: 0'
single cfun__4 "$CF" '+CFUN: 4'
single cfun__no_space "$CF" '+CFUN:1'
single cfun__two_colons "$CF" '+CFUN: 1: 2'
single cfun__spaces "$CF" '+CFUN:  1 '
single cfun__empty_value "$CF" '+CFUN: '
single cfun__hostile "$CF" "+CFUN: ${H}'\"\`id\`;x"
single cfun__two_lines "$CF" '+CFUN: 4' '+CFUN: 1'
single cfun__text_before "$CF" 'x+CFUN: 7'
rawf cfun__cr_mid 'AT+CFUN?\r\r\n+CFUN: 1\r5\r\n\r\nOK\r\n'
rawf cfun__echo_only 'AT+CFUN?\r\r\n'
errreply cfun__error "$CF" 'ERROR'
errreply cfun__cme "$CF" '+CME ERROR: 13'
emptyf cfun__empty
rawf cfun__ok_only 'OK\r\n'
lfonly cfun__lf_only "$CF" '+CFUN: 1'

# ----------------------------------------------------------------- simid --
compound simid__live "$SI" '515039876543210' '+QCCID: 8963000000000000000F'
compound simid__imsi_14 "$SI" '51503987654321' '+QCCID: 8963'
compound simid__imsi_16 "$SI" '5150398765432101' '+QCCID: 8963'
compound simid__imsi_space "$SI" '515039876543 210' '+QCCID: 8963'
compound simid__imsi_two "$SI" '111111111111111' '222222222222222' '+QCCID: 1'
compound simid__no_qccid "$SI" '515039876543210'
compound simid__qccid_two "$SI" '515039876543210' '+QCCID: 111' '+QCCID: 222'
compound simid__qccid_hostile "$SI" '515039876543210' "+QCCID: ${H}'x\"\`id\`"
compound simid__qccid_spaces "$SI" '+QCCID:  89 63 00 '
compound simid__qccid_nospace "$SI" '+QCCID:8963'
compound simid__qccid_twice "$SI" 'a+QCCID: b+QCCID: c'
compound simid__qccid_empty "$SI" '+QCCID: '
compound simid__qccid_empty_then_value "$SI" '+QCCID: ' '+QCCID: 77'
rawf simid__imsi_cr_mid 'AT+CIMI;+QCCID\r\r\n51503987\r6543210\r\n\r\nOK\r\n'
errreply simid__error "$SI" 'ERROR'
errreply simid__cme "$SI" '+CME ERROR: 10'
emptyf simid__empty
lfonly simid__lf_only "$SI" '515039876543210' '+QCCID: 8963'

# ----------------------------------------------------------- ident/CNUM --
compound ident__cnum_plain "$T2" '+COPS: 0,0,"Smart",7' '+QUIMSLOT: 2' '+CNUM: ,"+639171234567",145' '+CPIN: READY'
compound ident__cnum_no_comma "$T2" '+CNUM: 12345' '+CPIN: READY'
compound ident__cnum_empty_number "$T2" '+CNUM: ,"",129' '+CPIN: READY'
compound ident__cnum_hostile "$T2" "+CNUM: ,\"${H}'\`id\`\",129" '+CPIN: READY'
compound ident__cnum_two "$T2" '+CNUM: ,"111",129' '+CNUM: ,"222",129'
compound ident__cnum_spaces "$T2" '+CNUM: "me", "1 2 3" ,129'
compound ident__cme_and_cnum "$T2" '+COPS: 0' '+CNUM: ,"999",129' '+CME ERROR: 10'
compound ident__cme_only "$T2" '+CME ERROR: 10'
compound ident__quimslot_value_cr "$T2" '+QUIMSLOT: 1 2 '
rawf ident__nul_bytes 'AT+COPS?;+QUIMSLOT?;+CNUM;+CPIN?\r\r\n+COPS: 0,0,"Sm\000art",7\r\n\r\n+CPIN: RE\000ADY\r\n\r\nOK\r\n'
rawf ident__invalid_utf8 'AT+COPS?;+QUIMSLOT?;+CNUM;+CPIN?\r\r\n+COPS: 0,0,"A\377\376B\303",7\r\n\r\n+CNUM: ,"\377",129\r\n\r\nOK\r\n'
compound ident__utf8_ctrl "$T2" "$(printf '+COPS: 0,0,"Gl\303\266be\001\033\177\\\\",7')"

# ------------------------------------------------- sig: echo option words --
compound sig__echo_words "$QS" '+QRSRP: -n,-e,-E,-neE,LTE' '+QRSRQ: -x,-,--5,1-2,LTE' '+QSINR: -nn,-en,-n-,e,NR5G'
compound sig__echo_words_nr "$QS" '+QRSRP: -Ene,-ne,-,-32768,NR5G' '+QRSRQ: -32768x,+5,0x10,-0,NR5G'
rawf sig__nul_and_ff 'AT+QRSRP;+QRSRQ;+QSINR\r\r\n+QRSRP: -9\0005,\377,-32768,-1,LTE\r\n\r\nOK\r\n'

# ----------------------------------------------------- ca: number rendering --
single ca__num_good "$QC" \
    '+QCAINFO: "PCC",1e2,100,"LTE BAND 1",1,007,-0,0,-1,1.50' \
    '+QCAINFO: "SCC",0.0001,75,"LTE BAND 3",1,1,1,1,1,1E-5' \
    '+QCAINFO: "SCC",1e21,50,"LTE BAND 7",1,1,1,1,1,123456789012345678' \
    '+QCAINFO: "SCC",.5,25,"LTE BAND 20",1,1,1,1,1,5.' \
    '+QCAINFO: "SCC",inf,15,"LTE BAND 8",1,1,1,1,1,-inf' \
    '+QCAINFO: "SCC",NaN,6,"LTE BAND 5",1,1,1,1,1,Infinity' \
    '+QCAINFO: "SCC",1e400,6,"LTE BAND 5",1,1,1,1,1,-1e400' \
    '+QCAINFO: "SCC",0.000123,6,"LTE BAND 5",1,1,1,1,1,1e-7' \
    '+QCAINFO: "SCC",100000000000000000000,6,"LTE BAND 5",1,1,1,1,1,1e17' \
    '+QCAINFO: "SCC",0.1,6,"LTE BAND 5",1,1,1,1,1,9007199254740993'
single ca__num_bad_nan "$QC" '+QCAINFO: "PCC",nan,100,"LTE BAND 1",1,1,1,1,1,1'
single ca__num_bad_true "$QC" '+QCAINFO: "PCC",true,100,"LTE BAND 1",1,1,1,1,1,1'
single ca__num_bad_hex "$QC" '+QCAINFO: "PCC",0x10,100,"LTE BAND 1",1,1,1,1,1,1'
single ca__num_bad_dot "$QC" '+QCAINFO: "PCC",.,100,"LTE BAND 1",1,1,1,1,1,1'
single ca__num_bad_exp "$QC" '+QCAINFO: "PCC",1e,100,"LTE BAND 1",1,1,1,1,1,1'
single ca__num_bad_sinr "$QC" '+QCAINFO: "PCC",1,100,"LTE BAND 1",1,1,1,1,1,12x'
single ca__nr_snr_more "$QC" \
    '+QCAINFO: "PCC",627264,12,"NR5G BAND 78",1,-80,-10,25' \
    '+QCAINFO: "SCC",627264,12,"NR5G BAND 78",1,-80,-10,0x1p3' \
    '+QCAINFO: "SCC",627264,12,"NR5G BAND 78",1,-80,-10,1e400' \
    '+QCAINFO: "SCC",627264,12,"NR5G BAND 78",1,-80,-10,0777' \
    '+QCAINFO: "SCC",627264,12,"NR5G BAND 78",1,-80,-10,-0' \
    '+QCAINFO: "SCC",627264,12,"NR5G BAND 78",1,-80,-10,+0' \
    '+QCAINFO: "SCC",627264,12,"NR5G BAND 78",1,-80,-10,0x10.5' \
    '+QCAINFO: "SCC",627264,12,"NR5G BAND 78",1,-80,-10,-.5' \
    '+QCAINFO: "SCC",627264,12,"NR5G BAND 78",1,-80,-10,75' \
    '+QCAINFO: "SCC",627264,12,"NR5G BAND 78",1,-80,-10,0xffffffffffffffffffff' \
    '+QCAINFO: "SCC",627264,12,"NR5G BAND 78",1,-80,-10,1e308'
rawf ca__nr_snr_tabs 'AT+QCAINFO\r\r\n+QCAINFO: "PCC",627264,12,"NR5G BAND 78",1,-80,-10,\t\r\n+QCAINFO: "SCC",627264,12,"NR5G BAND 78",1,-80,-10,5\tx\r\n+QCAINFO: "SCC",627264,12,"NR5G BAND 78",1,-80,-10,\t-250\r\n\r\nOK\r\n'
single ca__band_double_prefix "$QC" '+QCAINFO: "PCC",627264,12,"NR5G BAND 78NRDCBAND",1,1,-80,-10,5' '+QCAINFO: "SCC",1,100,"LTEBANDLTE BAND 2",1,1,1,1,1,1'
rawf ca__ctrl_and_utf8 'AT+QCAINFO\r\r\n+QCAINFO: "PCC",1,100,"LTE BAND 1\001\033\177\303\266\\\\",1,1,1,1,1,1\r\n\r\nOK\r\n'
rawf ca__nul_bytes 'AT+QCAINFO\r\r\n+QCAINFO: "PCC",9485,1\0000,"LTE BAND 28",1,135,-115,-12,-82,2\r\n\r\nOK\r\n'

# --------------------------------------------------------------- qeng extras --
single qeng__sa_cellid_7fff "$QE" '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,7FFFFFFFFFFFFFFF,100,0FFFFF,627264,78,12,-80,-10,5,1,-'
single qeng__sa_cellid_8000 "$QE" '+QENG: "servingcell","NOCONN","NR5G-SA","TDD",515,03,8000000000000000,100,00,627264,78,12,-80,-10,5,1,-'
single qeng__lte_cellid_leading_zeros "$QE" '+QENG: "servingcell","NOCONN","LTE","FDD",515,03,00000000000000000002D1AB04,135,1350,3,5,5,000A1B2,-95,-10,-65,10,-'
single qeng__qeng_only "$QE" '+QENG:'
rawf qeng__nul_and_ff 'AT+QENG="servingcell"\r\r\n+QENG: "servingcell","NOCONN","LTE","FDD",515,03,2D1\000AB04,135,13\3770,3,5,5,A1B2,-95,-10,-65,10,-\r\n\r\nOK\r\n'
single qeng__hostile_all "$QE" "+QENG: \"servingcell\",\"CONNECT\",\"LTE\",\"FDD\",${H},'q',\`id\`,;,\\\\,\$HOME,5,5,A1B2,-9,-1,-6,1\"'\""
single qeng__nsa_hostile_nr "$QE" '+QENG: "servingcell","NOCONN"' '+QENG: "LTE","FDD",515,03,2D1AB04,135,1350,3,5,5,A1B2,-95,-10,-65,10' "+QENG: \"NR5G-NSA\",515,03,${H},-80,\`id\`,-10,627264,78,12,'1'"

echo "wrote $N fixtures to $OUT"
