# Auto-failback enabled (1 min interval) with a resumed failover: the blind
# primary recheck swaps back to slot 1, the primary is healthy after the settle
# -> failback (record removed, profile applied, tower failover restarted).
SC_PASSES=22
sc_setup() {
    uci_set quecmanager.watchcat.primary_recheck_enabled 1
    uci_set quecmanager.watchcat.primary_recheck_interval 1
    mset slot 2
    failover_write true 1 2
}
