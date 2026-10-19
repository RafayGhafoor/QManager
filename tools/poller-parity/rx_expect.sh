#!/bin/sh
# rx_expect.sh: expected globals for the Rust poll parsers (B5.29 Phase D).
#
#   rx_expect.sh cases                       > cases.tsv   (case list)
#   rx_expect.sh run <parse_at.sh> <poller> <cases.tsv> > expected.bin
#
# Runs ON THE DEVICE (BusyBox ash is the authority). For every case it starts a
# fresh subshell, sets every dumped global to SENT_<name>, sources the fixture
# sidecars (<fixture>.env), then runs the poller's own step code against a
# stubbed qcmd that prints the fixture and exits with the case's rc:
#   qeng  -> poll_serving_cell           (extracted from the poller)
#   ca    -> the QCAINFO block of poll_cycle (extracted)
#   cfun  -> the CFUN block of poll_cycle    (extracted)
#   sig   -> poll_per_antenna_signal     (append_signal_history stubbed)
#   ident -> poll_tier2 (ap_tier=active)
#   simid -> refresh_sim_identity
# Output: per case "\001<case id>\000" then "<name>=<value>\000" for every
# dumped global whose value is no longer its sentinel. NUL cannot occur in a
# shell value, so the encoding is unambiguous. Case id: steps|rcs|fixtures,
# each a comma list in step order.

RX_NAMES="lte_state lte_band lte_earfcn lte_bandwidth lte_pci lte_rsrp lte_rsrq lte_sinr lte_rssi lte_cell_id lte_enodeb_id lte_sector_id lte_tac lte_ta nr_state nr_band nr_arfcn nr_cell_id nr_enodeb_id nr_sector_id nr_tac nr_pci nr_rsrp nr_rsrq nr_sinr nr_scs nr_ta t1_temperature t1_cfun t2_carrier t2_sim_status t2_sim_slot t2_ca_active t2_ca_count t2_nr_ca_active t2_nr_ca_count t2_total_bandwidth_mhz t2_bandwidth_details t2_carrier_components sig_lte_rsrp sig_lte_rsrq sig_lte_sinr sig_nr_rsrp sig_nr_rsrq sig_nr_sinr network_type service_status boot_phone_number boot_imsi boot_iccid errors"

RX_TAB=$(printf '\t')

rx_cases() {
    _all=""
    for _f in fixtures/*.txt fixtures_rust/*.txt; do
        case "$_f" in */helpers__*|*/temperature__*) continue ;; esac
        _all="$_all $_f"
    done
    # 1. every fixture through every step, rc 0
    for _f in $_all; do
        for _s in qeng ca cfun sig ident simid; do
            printf '%s|0|%s\n' "$_s" "$_f"
        done
    done
    # 2. non-zero qcmd exit with real content (rc is ignored by sig/ident/cfun/simid)
    for _f in fixtures/serving_cell__live_a.txt fixtures/ca_info__live_a.txt fixtures/signal__live_a.txt fixtures/tier2__live_a.txt fixtures_rust/cfun__1.txt fixtures_rust/simid__live.txt fixtures/serving_cell__empty.txt; do
        for _s in qeng ca cfun sig ident simid; do
            printf '%s|1|%s\n' "$_s" "$_f"
        done
    done
    printf '%s|3|%s\n' qeng fixtures/serving_cell__live_a.txt ca fixtures/ca_info__live_a.txt
    # 3. qeng then ca in one batch (ca reads network_type / lte_state / nr_state)
    for _q in fixtures/serving_cell__*.txt fixtures_rust/qeng__*.txt; do
        for _c in fixtures/ca_info__live_a.txt fixtures/ca_info__reconcile_default_sentinel.txt fixtures/ca_info__nsa_lte_pcc_nr_scc_double.txt fixtures/ca_info__sa_pcc_two_scc.txt fixtures/ca_info__error.txt; do
            printf 'qeng,ca|0,0|%s,%s\n' "$_q" "$_c"
        done
    done
    printf 'qeng,ca|1,0|fixtures/serving_cell__live_a.txt,fixtures/ca_info__reconcile_default_sentinel.txt\n'
    # 4. whole batches
    printf 'qeng,ca,cfun,sig,ident,simid|0,0,0,0,0,0|fixtures/serving_cell__live_a.txt,fixtures/ca_info__live_a.txt,fixtures_rust/cfun__1.txt,fixtures/signal__live_a.txt,fixtures/tier2__live_a.txt,fixtures_rust/simid__live.txt\n'
    printf 'qeng,ca,cfun,sig,ident,simid|1,1,1,1,0,0|fixtures/serving_cell__empty.txt,fixtures/ca_info__empty.txt,fixtures_rust/cfun__empty.txt,fixtures/signal__empty.txt,fixtures_rust/ident__cme_only.txt,fixtures_rust/simid__empty.txt\n'
    printf 'qeng,ident|1,0|fixtures/serving_cell__live_a.txt,fixtures_rust/ident__cme_and_cnum.txt\n'
    printf 'ident,qeng|0,1|fixtures_rust/ident__cme_and_cnum.txt,fixtures/serving_cell__live_a.txt\n'
    printf 'qeng,ca,cfun,sig|0,0,0,0|fixtures/serving_cell__nsa_connect.txt,fixtures/ca_info__nsa_lte_pcc_nr_scc_double.txt,fixtures_rust/cfun__4.txt,fixtures/signal__nsa_both.txt\n'
    printf 'qeng,ca,cfun,sig|0,0,0,0|fixtures/serving_cell__sa_connect.txt,fixtures/ca_info__sa_pcc_two_scc.txt,fixtures_rust/cfun__0.txt,fixtures/signal__nr_only.txt\n'
}

rx_extract_fn() { # <file> <name>
    awk -v n="$2" '$0 ~ "^" n "\\(\\) \\{" {p=1} p {print} p && /^}/ {exit}' "$1"
}

rx_run() {
    RX_LIB=$1
    RX_POLLER=$2
    RX_CASES=$3
    . ./shim.sh
    pp_source_lib "$RX_LIB"
    _CR=$(printf '\r')
    _US=$(printf '\037')
    _NL='
'
    _QR=""
    RX_DEFS=/tmp/rpx/rx_defs_$$.sh
    {
        for _fn in _rm_chars _first_line_with qcmd_exec_g poll_serving_cell poll_per_antenna_signal poll_tier2 refresh_sim_identity; do
            rx_extract_fn "$RX_POLLER" "$_fn"
        done
        echo 'rx_ca() {'
        awk '/qcmd_exec_g .AT\+QCAINFO./ {p=1} /# CFUN .* standalone query/ {exit} p {print}' "$RX_POLLER"
        echo '}'
        echo 'rx_cfun() {'
        awk '/local cfun_result/ {p=1} /# Tier 1 \(per-antenna signal\)/ {exit} p {print}' "$RX_POLLER"
        echo '}'
    } > "$RX_DEFS"
    . "$RX_DEFS"
    rm -f "$RX_DEFS"
    _tap_at() { :; }
    log_warn() { :; }
    log_info() { :; }
    append_signal_history() { :; }
    qcmd() { cat "$RX_FIX"; return "$RX_RC"; }
    ap_tier=active

    while IFS= read -r RX_CASE || [ -n "$RX_CASE" ]; do
        [ -n "$RX_CASE" ] || continue
        (
            for _n in $RX_NAMES; do eval "$_n=SENT_$_n"; done
            OIFS=$IFS
            IFS='|'
            set -f
            set -- $RX_CASE
            IFS=$OIFS
            set +f
            RX_S=$1 ; RX_R=$2 ; RX_F=$3
            IFS=,
            set -- $RX_F
            IFS=$OIFS
            for _f; do [ -f "$_f.env" ] && . "./$_f.env"; done
            RX_I=0
            IFS=,
            for RX_STEP in $RX_S; do
                IFS=$OIFS
                RX_I=$((RX_I + 1))
                RX_FIX=$(echo "$RX_F" | cut -d, -f$RX_I)
                RX_RC=$(echo "$RX_R" | cut -d, -f$RX_I)
                case "$RX_STEP" in
                    qeng)  poll_serving_cell ;;
                    ca)    rx_ca ;;
                    cfun)  rx_cfun ;;
                    sig)   poll_per_antenna_signal ;;
                    ident) poll_tier2 ;;
                    simid) refresh_sim_identity ;;
                esac
                IFS=,
            done
            IFS=$OIFS
            printf '\001%s\000' "$RX_CASE"
            for _n in $RX_NAMES; do
                eval "_v=\$$_n"
                [ "$_v" = "SENT_$_n" ] || printf '%s=%s\000' "$_n" "$_v"
            done
        )
    done < "$RX_CASES"
}

case "$1" in
    cases) rx_cases ;;
    run)   shift ; rx_run "$@" ;;
    *) echo "usage: rx_expect.sh cases | run <parse_at.sh> <poller> <cases.tsv>" >&2 ; exit 2 ;;
esac
