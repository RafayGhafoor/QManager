# The first AT+CFUN=1 after the swap is lost (the radio stays off). The swap
# reads CFUN back, sees 0, sends AT+CFUN=1 again and then succeeds: Tier 3
# completes on slot 2 and the cooldown finalizes the failover.
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
    mset link_slot_2 true
    mset cfun_lost 1
}
sc_pass_2() { mset link_slot_1 false; }
sc_qcmd() {
    case "$1" in
        AT+CFUN=0) mset cfun 0; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1)
            _n=$(mget cfun_lost 0)
            if [ "$_n" -gt 0 ]; then
                mset cfun_lost $(( _n - 1 ))
            else
                mset cfun 1
            fi
            printf 'OK\r\n'
            return 0
            ;;
    esac
    return 100
}
sc_snap_extra() { echo "cfun=$(mget cfun 1) slot=$(mget slot 1)"; }
