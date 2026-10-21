# Tier 3 swaps to slot 2 but AT+CPIN? never answers with a +CPIN line (empty
# slot): 3 retries, then sim_failover_fallback reverts to slot 1. The primary
# stays down, so the cooldown fails and the ladder is exhausted.
SC_PASSES=26
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
    mset cpin_slot2 "+CME ERROR: 10"
}
sc_pass_2() { mset link_slot_1 false; }
