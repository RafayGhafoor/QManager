# Quality recovery: Tier 1 does not clear the loss, so the quality cooldown
# fails and escalates to Tier 2, whose CFUN=1 clears it -> quality success.
SC_PASSES=22
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset q_loss 50; mset q_latency 400.5; }
sc_qcmd() {
    case "$1" in
        AT+CFUN=1) mset q_loss 0; mset q_latency 24.5; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
