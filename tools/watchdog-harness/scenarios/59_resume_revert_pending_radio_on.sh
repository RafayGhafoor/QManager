# Round-2 M6: the record on disk says a swap back to slot 1 was deferred for
# airplane mode (revert_pending:true) before the daemon restarted. At startup the
# radio reads AT+CFUN=1, so the swap back runs at once (no radio_off state) and the
# post-revert settle follows; the record is removed.
SC_PASSES=16
sc_setup() {
    mset slot 2
    failover_write true 1 2
    jq -c '. + {revert_pending:true}' "$H_ROOT/tmp/qmanager_sim_failover" > "$H_ROOT/tmp/fo.tmp"
    mv "$H_ROOT/tmp/fo.tmp" "$H_ROOT/tmp/qmanager_sim_failover"
    cp "$H_ROOT/tmp/qmanager_sim_failover" "$H_ROOT/etc/qmanager/sim_failover.json"
}
sc_snap_extra() { echo "slot=$(mget slot 1) sim_failover_active=$sim_failover_active pending=$wd_sim_revert_pending"; }
