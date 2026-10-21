# Item 7: the user turns the radio off (AT+CFUN=4) while the link is down. The
# start gate reads +CFUN: 4 and parks the daemon in state radio_off: no AT action
# (at.log holds only AT+CFUN? reads, never AT+CFUN=1 or COPS), counters reset, one
# event. When +CFUN: 1 is back (and the link with it) the next pass returns to
# monitor and the quality window is re-marked.
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
}
sc_pass_2() { mset reachable false; mset cfun 4; }
sc_pass_10() { mset cfun 1; mset reachable true; }
sc_snap_extra() {
    echo "quality_since=$quality_since radio_down=$wd_radio_down"
}
