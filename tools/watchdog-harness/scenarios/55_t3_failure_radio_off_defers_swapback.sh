# Wave-2 M6: Tier 3 swaps to slot 2 (no link there) and the user turns the radio
# off (AT+CFUN=4) during the cooldown. The failed cooldown must not cycle the radio
# for the swap back: the daemon keeps the modem on slot 2 as a recorded failover,
# parks in radio_off and sends no AT+CFUN=0/QUIMSLOT. When the radio is on again
# (pass 22) the deferred swap back to slot 1 runs and the settle follows.
SC_PASSES=40
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
sc_pass_22() { mset cfun 1; mset link_slot_1 true; }
sc_qcmd() {
    case "$1" in
        AT+CFUN=0) mset cfun 0; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1) mset cfun 1; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() { echo "slot=$(mget slot 1) cfun=$(mget cfun 1) sim_failover_active=$sim_failover_active pending=$wd_sim_revert_pending"; }
