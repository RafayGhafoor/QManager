# Round-2 item 5: as 61, but the adopt re-read (the 10th read after the swap) works
# and shows slot 2: the failover is adopted (confirmed record saved, active) and
# Tier 3 goes on to the CPIN check and the cooldown.
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
        AT+QUIMSLOT=2) mset swapped 1; return 100 ;;
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
sc_snap_extra() { echo "slot=$(mget slot 1) ureads=$(mget ureads 0) sim_failover_active=$sim_failover_active"; }
