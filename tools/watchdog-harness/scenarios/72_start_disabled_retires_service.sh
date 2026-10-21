# Started (as a procd respawn would) with UCI enabled=0: the daemon logs once,
# disables and stops its own service so procd does not re-run it, and exits.
SC_PASSES=2
sc_setup() {
    uci_set quecmanager.watchcat.enabled 0
}
