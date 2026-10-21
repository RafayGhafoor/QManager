# Round-3 L1: as 66, but the radio is turned back on (pass 17) while the maintenance
# lock is still held. At the unlock (pass 19) AT+CFUN? reads 1, so the deferred
# swap back to slot 1 runs at once and the post-revert settle follows.
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
sc_pass_17() { mset cfun 1; mset link_slot_1 true; }
sc_pass_19() { h_rm qmanager_watchcat.lock; }
sc_qcmd() {
    case "$1" in
        AT+CFUN=0) mset cfun 0; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1) mset cfun 1; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() { echo "slot=$(mget slot 1) cfun=$(mget cfun 1) sim_failover_active=$sim_failover_active pending=$wd_sim_revert_pending"; }
