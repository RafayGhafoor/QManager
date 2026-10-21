# Startup with a failover record whose current slot matches the live slot:
# the record is resumed (sim_failover_active=true, original ICCID restored).
SC_PASSES=4
sc_setup() {
    mset slot 2
    failover_write true 1 2
}
