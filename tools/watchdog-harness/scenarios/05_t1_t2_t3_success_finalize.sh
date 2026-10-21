# Tier 1 and Tier 2 do not help; Tier 3 swaps to the backup SIM (slot 2, link up)
# and the 90 s settle cooldown confirms it: failover record finalized, SIM
# recorded, profile auto-applied.
SC_PASSES=34
sc_setup() {
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
    mset link_slot_2 true
}
sc_pass_2() { mset link_slot_1 false; }
