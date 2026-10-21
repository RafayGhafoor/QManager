# A user revert is requested after the modem was already moved back to the
# original slot by other means: the swap finds the target live and does not
# cycle the radio; the record is cleared and there is no settle.
SC_PASSES=10
sc_setup() {
    mset slot 2
    failover_write true 1 2
}
sc_pass_3() { mset slot 1; h_touch qmanager_watchcat_revert_sim; }
sc_snap_extra() { echo "slot=$(mget slot 1)"; }
