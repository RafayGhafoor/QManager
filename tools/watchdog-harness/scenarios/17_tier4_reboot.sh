# Only Tier 4 enabled, bucket not full: crash.log gains a tier4_escalation row
# (and is trimmed to 20 lines), state is flushed and the reboot is issued after
# the response path (stubbed reboot).
SC_PASSES=12
sc_setup() {
    uci_set quecmanager.watchcat.tier1_enabled 0
    uci_set quecmanager.watchcat.tier2_enabled 0
    i=0
    while [ "$i" -lt 21 ]; do
        crash_log_add $(( 5000 + i )) tier4_escalation
        i=$((i + 1))
    done
    crash_log_add 120 tier4_escalation
}
sc_pass_2() { mset reachable false; }
