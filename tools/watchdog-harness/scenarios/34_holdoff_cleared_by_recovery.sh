# Item 10: the pause after an exhausted ladder ends as soon as the link comes back
# on its own. Tier 1 only, and it never restores the link: the ladder is
# exhausted (holdoff_until set, no AT while the outage lasts), the link returns
# by itself at pass 10 (holdoff_until back to 0), and a new outage at pass 14
# starts a fresh Tier 1 within three passes instead of waiting out 900 s.
SC_PASSES=24
sc_setup() {
    uci_set quecmanager.watchcat.tier2_enabled 0
    uci_set quecmanager.watchcat.tier4_enabled 0
}
sc_pass_2() { mset reachable false; }
sc_pass_10() { mset reachable true; }
sc_pass_14() { mset reachable false; }
sc_snap_extra() {
    _t_left=$(( holdoff_until - $(mono_now) ))
    [ "$_t_left" -lt 0 ] && _t_left=0
    echo "holdoff_until=$holdoff_until holdoff_left=$_t_left"
}
