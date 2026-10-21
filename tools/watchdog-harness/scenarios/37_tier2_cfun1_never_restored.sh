# Item 7: Tier 2 only (tiers 1 and 4 off) and the radio never comes back: both
# AT+CFUN=1 are swallowed. The daemon logs an error, keeps the radio-down marker
# (wd_radio_down stays 1, so its exit cleanup would restore the radio) and does
# NOT read the leftover CFUN=0 as the user's airplane mode: the failed cooldown
# ends in the exhausted-ladder path, not radio_off.
SC_PASSES=10
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+CFUN=0) mset cfun 0; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1) printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "radio_down=$wd_radio_down"
}
