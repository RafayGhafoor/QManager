# Maintenance lock via the long-running flag while the link is suspect: LOCKED
# entry/exit resets counters; the outage is then handled normally by Tier 1.
SC_PASSES=18
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_3() { h_touch qmanager_long_running; }
sc_pass_6() { h_rm qmanager_long_running; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
