# Link stays reachable but packet loss breaches the shared ceiling for 3
# consecutive passes: quality-triggered Tier 1, loss clears, cooldown(quality)
# success.
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset q_loss 50; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset q_loss 0; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
