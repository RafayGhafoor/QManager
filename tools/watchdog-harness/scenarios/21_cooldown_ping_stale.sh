# Tier 1 runs, then the ping cache goes stale during the cooldown: 3 stale
# retries (+10 s each) then the failure path escalates to Tier 2, whose CFUN=1
# restores the cache and the link -> success.
SC_PASSES=26
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset ping_stale 1; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1) mset ping_stale 0; mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
