# Startup with a failover record naming slot 2 while the modem is on slot 1:
# the stale record is removed and the daemon starts without a failover.
SC_PASSES=4
sc_setup() {
    mset slot 1
    failover_write true 1 2
}
