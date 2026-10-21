# Config reload with enabled=0: the daemon logs, writes state=disabled and exits.
SC_PASSES=8
sc_pass_2() {
    uci_set quecmanager.watchcat.enabled 0
    h_touch qmanager_watchcat_reload
}
