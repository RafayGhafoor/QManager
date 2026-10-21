# Wave-2 H1: Tier 3 swaps to slot 2 (no link there) and the swap back to slot 1
# is swallowed. The modem is left on the backup, so the daemon adopts the real
# state: sim_failover_active true and a failover record (original 1, current 2)
# instead of an unrecorded backup SIM. A user revert at pass 22, after slot 1
# answers again, is then honoured (the request used to wait forever).
SC_PASSES=34
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
    mset link_slot_2 false
    mset q1_swallow 1
}
sc_pass_2() { mset link_slot_1 false; }
sc_pass_20() { mset q1_swallow 0; mset link_slot_1 true; h_touch qmanager_watchcat_revert_sim; }
sc_qcmd() {
    case "$1" in
        AT+QUIMSLOT=1)
            [ "$(mget q1_swallow 0)" = "1" ] || mset slot 1
            printf 'OK\r\n'
            return 0
            ;;
    esac
    return 100
}
sc_snap_extra() { echo "slot=$(mget slot 1) sim_failover_active=$sim_failover_active current_sim_slot=$current_sim_slot original_sim_slot=$original_sim_slot"; }
