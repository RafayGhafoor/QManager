# Both records say the modem is on slot 2, but it reads slot 1: stale, so both
# the /tmp and the /etc record are removed and the failover is not resumed.
SC_PASSES=5
sc_setup() {
    mset slot 1
    failover_write true 1 2
    cp "$H_ROOT/tmp/qmanager_sim_failover" "$H_ROOT/etc/qmanager/sim_failover.json"
}
