# Round-2 M4: Tier 2 (tiers 1/3/4 off) sends AT+CFUN=0 and both AT+CFUN=1 are
# swallowed, so the radio-down marker sticks. The modem turns the radio on by itself
# and the link recovers (pass 14); the cooldown succeeds and the marker is still set.
# The next monitor pass sees a reachable link and clears it (radio_down 0, no AT
# cost). At pass 30 the user sets AT+CFUN=4 and the link goes down: the start gate
# honours the airplane mode (radio_off) and the daemon sends no AT+CFUN, not even at
# exit. With the marker stuck the gate would have toggled the radio over the user's
# airplane mode.
SC_PASSES=40
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_14() { mset cfun 1; mset reachable true; }
sc_pass_30() { mset cfun 4; mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+CFUN=0) mset cfun 0; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1) printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "radio_down=$wd_radio_down cfun=$(mget cfun 1)"
}
