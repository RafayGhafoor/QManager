# AT+QUIMSLOT= answers OK but the slot never moves. Tier 3 tries the swap twice,
# cannot verify it, restarts tower failover and skips the tier: no failover
# record, original_sim_slot stays null, and the radio is back on (CFUN 1).
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
    mset quimslot_swallow 1
}
sc_pass_2() { mset link_slot_1 false; }
sc_qcmd() {
    case "$1" in
        AT+CFUN=0) mset cfun 0; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1) mset cfun 1; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() { echo "cfun=$(mget cfun 1) slot=$(mget slot 1)"; }
