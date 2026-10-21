# Item 6: fewer than 3 samples since the window mark is "no signal", even when
# every sample is lost. The mark is set after the boot settle, so passes 1 and 2
# (0 and 2 samples at a 5 s ping interval) report no signal and count nothing;
# from pass 3 the window has 4 samples and the breach counter starts. A high
# quality_consecutive keeps recovery out of the picture.
SC_PASSES=6
sc_setup() {
    uci_set quecmanager.watchcat.quality_enabled 1
    uci_set quecmanager.watchcat.quality_consecutive 10
    uci_set quecmanager.watchcat.tier4_enabled 0
    mset q_loss 100
}
sc_snap_extra() {
    echo "quality_since=$quality_since breach=$quality_breach_counter"
    if read_quality; then
        echo "window: loss=$q_packet_loss avg=$q_avg_latency"
    else
        echo "window: no signal"
    fi
}
