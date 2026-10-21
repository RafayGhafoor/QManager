# Wave-2 H2: the swap to slot 2 really happens, but AT+CFUN? never answers with a
# level, so wd_swap_slot cannot prove the radio. Instead of reporting a failed
# swap (modem on slot 2 with no record, tier skipped) it re-reads the slot, sends
# one last AT+CFUN=1 and returns "switched, radio unconfirmed": Tier 3 goes on,
# the link is up on slot 2 and the cooldown finalizes the failover. The radio-down
# marker stays set (CFUN never read 1), so the exit cleanup restores the radio.
SC_PASSES=16
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
    mset link_slot_2 true
}
sc_pass_2() { mset link_slot_1 false; }
sc_qcmd() {
    case "$1" in
        "AT+CFUN?") printf 'ERROR\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() { echo "slot=$(mget slot 1) radio_down=$wd_radio_down sim_failover_active=$sim_failover_active"; }
