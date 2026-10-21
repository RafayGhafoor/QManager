# A maintenance lock lands during the primary-recheck settle: LOCKED entry marks
# the recheck interrupted; on exit the settle is re-armed and finish_cooldown
# decides failback (primary healthy).
SC_PASSES=28
sc_setup() {
    uci_set quecmanager.watchcat.primary_recheck_enabled 1
    uci_set quecmanager.watchcat.primary_recheck_interval 1
    mset slot 2
    failover_write true 1 2
}
sc_pass_6() { h_touch qmanager_watchcat.lock; }
sc_pass_8() { h_rm qmanager_watchcat.lock; }
