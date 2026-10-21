# A user revert is requested while a maintenance lock file exists: the request
# is deferred (flag kept, record kept, no AT cycle) and only runs once the
# lock is gone.
SC_PASSES=18
sc_setup() {
    mset slot 2
    failover_write true 1 2
}
sc_pass_3() { h_touch qmanager_watchcat_revert_sim; h_touch qmanager_watchcat.lock; }
sc_pass_7() { h_rm qmanager_watchcat.lock; }
