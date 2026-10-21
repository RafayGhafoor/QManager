# A finalized failover is active (resumed from the record); the user asks for a
# revert via the revert flag: fallback to slot 1, record removed, 90 s settle.
SC_PASSES=18
sc_setup() {
    mset slot 2
    failover_write true 1 2
}
sc_pass_3() { h_touch qmanager_watchcat_revert_sim; }
