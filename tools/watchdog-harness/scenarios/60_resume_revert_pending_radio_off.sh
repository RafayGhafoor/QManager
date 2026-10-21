# Round-2 M6: as 59, but the radio is still off (AT+CFUN=4) when the daemon starts.
# The failover resumes and the daemon parks in radio_off with the swap back pending
# (the record keeps revert_pending). When the radio reads 1 again (pass 6) the swap
# back to slot 1 runs, the settle follows and the record is removed.
SC_PASSES=22
sc_setup() {
    mset slot 2
    mset cfun 4
    failover_write true 1 2
    jq -c '. + {revert_pending:true}' "$H_ROOT/tmp/qmanager_sim_failover" > "$H_ROOT/tmp/fo.tmp"
    mv "$H_ROOT/tmp/fo.tmp" "$H_ROOT/tmp/qmanager_sim_failover"
    cp "$H_ROOT/tmp/qmanager_sim_failover" "$H_ROOT/etc/qmanager/sim_failover.json"
}
sc_pass_6() { mset cfun 1; }
sc_snap_extra() { echo "slot=$(mget slot 1) cfun=$(mget cfun 1) sim_failover_active=$sim_failover_active pending=$wd_sim_revert_pending"; }
