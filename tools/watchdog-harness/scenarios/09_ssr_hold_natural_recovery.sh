# Outage coincides with a fresh MPSS SSR line in dmesg: the ladder is held
# (ssr_hold), and the link returns on its own -> natural recovery clears the hold.
SC_PASSES=12
sc_pass_2() { mset reachable false; }
sc_pass_3() { dmesg_crash 5; }
sc_pass_6() { mset reachable true; }
