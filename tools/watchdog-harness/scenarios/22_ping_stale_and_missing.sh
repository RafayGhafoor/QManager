# Monitor-state read_ping failures: stale cache, then missing cache, then back.
# No recovery decisions are made on unknown data.
SC_PASSES=12
sc_pass_2() { mset ping_stale 1; }
sc_pass_6() { rm -f "$H_ROOT/tmp/qmanager_ping.json"; }
sc_pass_8() { mset ping_stale 0; }
