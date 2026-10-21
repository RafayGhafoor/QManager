# Tier 3 swaps to slot 2 whose SIM answers +CPIN: SIM PIN (present, not usable):
# falls back to slot 1 through the "not ready" arm. Primary recovers after the
# revert, so the cooldown succeeds.
SC_PASSES=24
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
    mset cpin_slot2 "+CPIN: SIM PIN"
}
sc_pass_2() { mset link_slot_1 false; }
sc_qcmd() {
    # the revert (QUIMSLOT=1) brings the primary back
    case "$1" in
        AT+QUIMSLOT=1) mset slot 1; mset link_slot_1 true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
