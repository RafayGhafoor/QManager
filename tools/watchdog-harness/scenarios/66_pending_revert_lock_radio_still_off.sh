# Round-3 L1: as 55 (Tier 3 swaps to slot 2, no link there, the user turns the radio
# off during the cooldown, the swap back is deferred), then a maintenance lock lands
# (pass 15) and ends (pass 19) while the radio is still off (AT+CFUN=4). The deferred
# swap back survives the lock: the daemon returns to radio_off with it still pending
# and sends no AT+CFUN=0/QUIMSLOT. It runs when the radio is on again (pass 26).
SC_PASSES=44
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
    mset link_slot_2 false
}
sc_pass_2() { mset link_slot_1 false; }
sc_pass_7() { mset cfun 4; }
sc_pass_15() { h_touch qmanager_watchcat.lock; }
sc_pass_19() { h_rm qmanager_watchcat.lock; }
sc_pass_26() { mset cfun 1; mset link_slot_1 true; }
sc_qcmd() {
    case "$1" in
        AT+CFUN=0) mset cfun 0; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1) mset cfun 1; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() { echo "slot=$(mget slot 1) cfun=$(mget cfun 1) sim_failover_active=$sim_failover_active pending=$wd_sim_revert_pending"; }
