# Round-2 item 3: the daemon was restarted while a Tier 3 cooldown was judging the
# swap, so the record on disk is unconfirmed (confirmed:false) and the modem is on
# the backup slot. It is resumed as a normal failover (sim_failover_active true) and
# the record is rewritten without the flag; the user revert at pass 4 is honoured.
SC_PASSES=14
sc_setup() {
    mset slot 2
    failover_write true 1 2
    jq -c '. + {confirmed:false}' "$H_ROOT/tmp/qmanager_sim_failover" > "$H_ROOT/tmp/fo.tmp"
    mv "$H_ROOT/tmp/fo.tmp" "$H_ROOT/tmp/qmanager_sim_failover"
    cp "$H_ROOT/tmp/qmanager_sim_failover" "$H_ROOT/etc/qmanager/sim_failover.json"
}
sc_pass_4() { h_touch qmanager_watchcat_revert_sim; }
sc_snap_extra() { echo "slot=$(mget slot 1) sim_failover_active=$sim_failover_active durable=$(cat "$H_ROOT/etc/qmanager/sim_failover.json" 2>/dev/null)"; }
