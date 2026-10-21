# Tier 3 swaps to slot 2 (no link there), then a maintenance lock appears
# mid-cooldown. When the lock is released the unconfirmed swap is reverted to
# slot 1 and the post-revert settle runs.
SC_PASSES=24
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
sc_pass_5() { h_touch qmanager_watchcat.lock; }
sc_pass_8() { h_rm qmanager_watchcat.lock; mset link_slot_1 true; }
