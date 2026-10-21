# Round-2 M3: a quality ladder (Tier 1 only) does not clear the packet loss, so it is
# exhausted and the 15 minute pause starts with holdoff_reason quality. The link is
# reachable all along; a single lost probe (pass 18: monitor -> suspect, pass 19: back
# to monitor) must not end that pause. The loss keeps breaching the ceiling, so before
# the fix the ladder restarted a few passes later (a new AT+COPS=2 after pass 19).
SC_PASSES=36
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier3_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset q_loss 50; }
sc_pass_18() { mset reachable false; }
sc_pass_19() { mset reachable true; }
sc_snap_extra() {
    _t_left=$(( holdoff_until - $(mono_now) ))
    [ "$_t_left" -lt 0 ] && _t_left=0
    echo "holdoff_left=$_t_left holdoff_reason=$holdoff_reason"
}
