# Round-2 item 5: Tier 3's AT+QUIMSLOT=2 is swallowed (the modem stays on slot 1)
# and the slot cannot be read right after it (wd_swap_slot rc 3). The adopt re-read
# shows slot 1: the tier is skipped, no record is kept and tower failover is
# restarted. Only Tier 3 is enabled, so the ladder is exhausted and the pause starts.
SC_PASSES=18
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 1
    uci_set quecmanager.watchcat.tier4_enabled 0
    uci_set quecmanager.watchcat.backup_sim_slot 2
    mset slot 1
    mset link_slot_2 true
}
sc_pass_2() { mset link_slot_1 false; }
sc_qcmd() {
    case "$1" in
        AT+QUIMSLOT=2) mset swapped 1; printf 'OK\r\n'; return 0 ;;
        "AT+QUIMSLOT?")
            if [ "$(mget swapped 0)" = "1" ]; then
                _t_n=$(( $(mget ureads 0) + 1 ))
                mset ureads "$_t_n"
                [ "$_t_n" -le 9 ] && { printf 'ERROR\r\n'; return 0; }
            fi
            ;;
    esac
    return 100
}
sc_snap_extra() { echo "slot=$(mget slot 1) ureads=$(mget ureads 0) sim_failover_active=$sim_failover_active original_sim_slot=$original_sim_slot"; }
