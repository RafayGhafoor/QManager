# Item 7: Tier 2 (tiers 1 and 4 off) sends AT+CFUN=0; the first AT+CFUN=1 is
# swallowed (the radio stays at CFUN=0). After wait_for_modem the daemon reads
# AT+CFUN? (0), sends AT+CFUN=1 once more, re-reads (1) and clears the radio-down
# marker (wd_radio_down 0 in every pass snapshot after the toggle). The second
# CFUN=1 also brings the link back, so the cooldown succeeds.
SC_PASSES=14
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_qcmd() {
    case "$1" in
        AT+CFUN=0) mset cfun 0; printf 'OK\r\n'; return 0 ;;
        AT+CFUN=1)
            _t_n=$(( $(mget cfun1_n 0) + 1 ))
            mset cfun1_n "$_t_n"
            if [ "$_t_n" -ge 2 ]; then mset cfun 1; mset reachable true; fi
            printf 'OK\r\n'
            return 0
            ;;
    esac
    return 100
}
sc_snap_extra() {
    echo "radio_down=$wd_radio_down"
}
