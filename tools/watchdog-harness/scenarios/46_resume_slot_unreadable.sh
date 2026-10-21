# The live slot cannot be read at startup (AT+QUIMSLOT? answers ERROR): both
# records are kept untouched and the failover is not activated.
SC_PASSES=5
sc_setup() {
    mset slot 2
    failover_write true 1 2
    cp "$H_ROOT/tmp/qmanager_sim_failover" "$H_ROOT/etc/qmanager/sim_failover.json"
}
sc_qcmd() {
    case "$1" in
        "AT+QUIMSLOT?") printf 'ERROR\r\n'; return 0 ;;
    esac
    return 100
}
