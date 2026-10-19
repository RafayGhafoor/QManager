#!/bin/sh
# rx_rust.sh <qcmd> <cases.tsv> > rust.bin
#
# Device leg of the Rust poll-parser parity (B5.29 Phase D). Same case list
# and the same output format as `rx_expect.sh run`, but every step goes
# through `<qcmd> --parse-only <step> <rc> < fixture` and the poller-side
# contract: the env is dot-sourced, and the globals a step reads
# (network_type / lte_state / nr_state) are handed to the next step as
# QM_IN_*. `cmp rust.bin expected.bin` must report no difference.
# Never touches the modem: --parse-only only parses stdin.

RX_QCMD=$1
RX_CASES=$2
RX_NAMES="lte_state lte_band lte_earfcn lte_bandwidth lte_pci lte_rsrp lte_rsrq lte_sinr lte_rssi lte_cell_id lte_enodeb_id lte_sector_id lte_tac lte_ta nr_state nr_band nr_arfcn nr_cell_id nr_enodeb_id nr_sector_id nr_tac nr_pci nr_rsrp nr_rsrq nr_sinr nr_scs nr_ta t1_temperature t1_cfun t2_carrier t2_sim_status t2_sim_slot t2_ca_active t2_ca_count t2_nr_ca_active t2_nr_ca_count t2_total_bandwidth_mhz t2_bandwidth_details t2_carrier_components sig_lte_rsrp sig_lte_rsrq sig_lte_sinr sig_nr_rsrp sig_nr_rsrq sig_nr_sinr network_type service_status boot_phone_number boot_imsi boot_iccid errors"
RX_ENV=/tmp/rpx/rx_rust_$$.env
trap 'rm -f "$RX_ENV"' EXIT

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
            QM_IN_network_type=$network_type QM_IN_lte_state=$lte_state QM_IN_nr_state=$nr_state \
                "$RX_QCMD" --parse-only "$RX_STEP" "$RX_RC" < "$RX_FIX" > "$RX_ENV" || echo "PARSE_FAIL $RX_CASE" >&2
            sh -n "$RX_ENV" || echo "SYNTAX $RX_CASE" >&2
            qm_poll_end=""
            . "$RX_ENV"
            [ "$qm_poll_end" = 1 ] || echo "NO_END $RX_CASE" >&2
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
