# Round-3 L1: as 59 (the record says a swap back to slot 1 was deferred for airplane
# mode, the radio reads AT+CFUN=1 at startup), but a maintenance lock is held when
# the daemon starts. The swap back is not run at startup: the daemon enters LOCKED
# with it pending and runs it at the unlock (pass 6).
SC_PASSES=20
sc_setup() {
    mset slot 2
    failover_write true 1 2
    jq -c '. + {revert_pending:true}' "$H_ROOT/tmp/qmanager_sim_failover" > "$H_ROOT/tmp/fo.tmp"
    mv "$H_ROOT/tmp/fo.tmp" "$H_ROOT/tmp/qmanager_sim_failover"
    cp "$H_ROOT/tmp/qmanager_sim_failover" "$H_ROOT/etc/qmanager/sim_failover.json"
    h_touch qmanager_watchcat.lock
}
sc_pass_6() { h_rm qmanager_watchcat.lock; }
sc_snap_extra() { echo "slot=$(mget slot 1) sim_failover_active=$sim_failover_active pending=$wd_sim_revert_pending"; }
