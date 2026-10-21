#!/bin/sh
# inner.sh - runs ONE scenario against the staged daemon (invoked by run.sh).
# Environment from run.sh: H_ROOT (fake filesystem root), H_STAGE (rewritten
# daemon + libs), H_STATE (harness state), H_OUT (output dir), H_CLOCK0, H_UP0,
# H_SCENARIO (scenario file), H_HARNESS (this directory). PATH holds only
# BusyBox applets + jq.
. "$H_HARNESS/lib.sh"
read -r H_MAINPID _h_rest < /proc/self/stat

# --- defaults ----------------------------------------------------------------
SC_PASSES=10
mkdir -p "$H_STATE/model" "$H_ROOT/tmp" "$H_ROOT/etc/qmanager" "$H_ROOT/var/run/qmanager"
printf '%s' "$H_CLOCK0" > "$H_STATE/clock"
printf '%s.00 0.00\n' "$H_UP0" > "$H_ROOT/proc_uptime"
: > "$H_STATE/dmesg.txt"
cat > "$H_STATE/uci.db" <<UCI
quecmanager.watchcat.enabled=1
quecmanager.watchcat.check_interval=10
quecmanager.watchcat.fail_threshold=3
quecmanager.watchcat.cooldown=30
quecmanager.watchcat.tier1_enabled=1
quecmanager.watchcat.tier2_enabled=1
quecmanager.watchcat.tier3_enabled=0
quecmanager.watchcat.tier4_enabled=1
quecmanager.watchcat.max_reboots_per_hour=3
quecmanager.watchcat.quality_enabled=0
quecmanager.watchcat.quality_consecutive=3
quecmanager.watchcat.ssr_aware=1
quecmanager.watchcat.ssr_grace=45
quecmanager.watchcat.primary_recheck_enabled=0
quecmanager.watchcat.primary_recheck_interval=1
UCI
: > "$H_OUT/at.log"
: > "$H_OUT/calls.log"
: > "$H_OUT/passes.txt"

. "$H_SCENARIO"
command -v sc_setup >/dev/null 2>&1 && sc_setup
h_refresh

# --- source the daemon without running main ------------------------------------
WATCHCAT_NO_MAIN=1
export WATCHCAT_NO_MAIN
WD_LIB_DIR="$H_STAGE/lib"
export WD_LIB_DIR
. "$H_STAGE/qmanager_watchcat"

# Must come after the daemon pulled in safe_tmp.sh: the sandbox user is not
# root, so the root-ownership gate is stubbed open (plan 3.2).
qm_trusted_file() { return 0; }

main
