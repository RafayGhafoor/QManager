# Wave-2 M5: a failover record exists at startup but the live slot cannot be read
# (AT+QUIMSLOT? answers ERROR until pass 3). The record is kept at startup and
# retried once a minute from the main loop: it is resumed at the first retry after
# the slot reads again (sim_failover_active true), so the user revert at pass 12
# is honoured instead of being dropped as "nothing to revert".
SC_PASSES=18
sc_setup() {
    mset slot 2
    mset slot_unreadable 1
    failover_write true 1 2
    cp "$H_ROOT/tmp/qmanager_sim_failover" "$H_ROOT/etc/qmanager/sim_failover.json"
}
sc_pass_3() { mset slot_unreadable 0; }
sc_pass_12() { h_touch qmanager_watchcat_revert_sim; }
sc_qcmd() {
    case "$1" in
        "AT+QUIMSLOT?")
            [ "$(mget slot_unreadable 0)" = "1" ] && { printf 'ERROR\r\n'; return 0; }
            ;;
    esac
    return 100
}
sc_snap_extra() { echo "slot=$(mget slot 1) sim_failover_active=$sim_failover_active"; }
