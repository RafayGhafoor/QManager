# Startup after a reboot: /tmp is empty, only the durable /etc record exists and
# its current slot matches the live slot. The failover resumes and the record
# is copied back to /tmp.
SC_PASSES=5
sc_setup() {
    mset slot 2
    failover_write true 1 2
    mv "$H_ROOT/tmp/qmanager_sim_failover" "$H_ROOT/etc/qmanager/sim_failover.json"
}
