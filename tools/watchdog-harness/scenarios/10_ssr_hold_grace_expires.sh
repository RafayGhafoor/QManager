# SSR hold engages but the link does not return within the 45 s grace: the hold
# is released to the ladder (Tier 1 here, whose COPS=0 restores the link).
SC_PASSES=18
sc_setup() {
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_3() { dmesg_crash 5; }
sc_qcmd() {
    case "$1" in
        AT+COPS=0) mset reachable true; printf 'OK\r\n'; return 0 ;;
    esac
    return 100
}
