# The radio comes back (AT+CFUN=1) but the link never returns. The streak
# carried over from airplane mode is discounted, so the outage is timed from
# the resume: recovery starts once fail_threshold failures pile up after it,
# not on the first pass.
SC_PASSES=16
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.fail_threshold 8
}
sc_pass_2() { mset reachable false; mset cfun 4; }
sc_pass_10() { mset cfun 1; }
sc_snap_extra() {
    echo "streak_base=$_radio_streak_base"
}
