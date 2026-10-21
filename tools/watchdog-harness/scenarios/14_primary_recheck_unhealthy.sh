# Primary recheck, but slot 1 still has no link: after the settle the daemon
# returns to the backup slot, rewrites the failover record and holds the
# post-recheck settle; a second recheck comes due later.
SC_PASSES=34
sc_setup() {
    uci_set quecmanager.watchcat.primary_recheck_enabled 1
    uci_set quecmanager.watchcat.primary_recheck_interval 1
    mset slot 2
    mset link_slot_1 false
    failover_write true 1 2
}
