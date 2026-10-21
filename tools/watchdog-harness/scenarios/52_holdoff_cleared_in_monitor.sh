# Wave-2 M3: Tier 1 only and it never restores the link, so the ladder is
# exhausted at pass 6 (state monitor, pause set). The link then heals before the
# loop ever sees a failing pass in suspect: the pause is cleared from monitor
# (holdoff_until 0 at pass 7), so the new outage at pass 10 starts a fresh Tier 1
# within three passes instead of sitting out 900 s.
SC_PASSES=20
sc_setup() {
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_7() { mset reachable true; }
sc_pass_10() { mset reachable false; }
sc_snap_extra() {
    _t_left=$(( holdoff_until - $(mono_now) ))
    [ "$_t_left" -lt 0 ] && _t_left=0
    echo "holdoff_until=$holdoff_until holdoff_left=$_t_left"
}
