# Tier 3 swaps to slot 2 but every AT+CPIN? fails in transport (qcmd rc!=0,
# empty stdout): 3 retries, then the fallback logs "no reply" instead of an rc.
SC_PASSES=26
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
}
sc_pass_2() { mset link_slot_1 false; }
sc_qcmd() {
    case "$1" in
        'AT+CPIN?') [ "$(mget slot)" = "2" ] && return 1 ;;
    esac
    return 100
}
