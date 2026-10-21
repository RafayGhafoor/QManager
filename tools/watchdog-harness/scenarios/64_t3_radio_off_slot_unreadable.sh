# Round-2 items 4 and 6: as 55 (Tier 3 swaps to slot 2, no link there, the user
# turns the radio off during the cooldown), but the slot cannot be read from the
# moment the radio goes off, so the deferral cannot adopt the failover
# (sim_failover_active stays false). The unconfirmed record gains revert_pending;
# when the radio is on again (pass 22) and the slot reads, the deferred swap back
# to slot 1 still runs although the failover was never marked active.
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
sc_pass_7() { mset cfun 4; mset slot_unreadable 1; }
sc_pass_22() { mset cfun 1; mset link_slot_1 true; mset slot_unreadable 0; }
sc_qcmd() {
    case "$1" in
        AT+CFUN=0) mset cfun 0; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1) mset cfun 1; printf 'OK\r\n'; return 0 ;;
        "AT+QUIMSLOT?")
            [ "$(mget slot_unreadable 0)" = "1" ] && { printf 'ERROR\r\n'; return 0; }
            ;;
    esac
    return 100
}
sc_snap_extra() { echo "slot=$(mget slot 1) cfun=$(mget cfun 1) sim_failover_active=$sim_failover_active pending=$wd_sim_revert_pending"; }
