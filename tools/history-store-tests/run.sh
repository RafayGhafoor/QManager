#!/bin/sh
# run.sh - run every history-store test. Usage: sh run.sh
# Env: HT_LIB HT_POLLER HT_TMP HT_FIX (see lib.sh). Exit 0 only if all pass.
HT_HERE="$(cd "$(dirname "$0")" && pwd)"
export HT_HERE
rc=0
for t in "$HT_HERE"/t_*.sh; do
    ${HT_SH:-sh} "$t" || rc=1
done
[ "$rc" -eq 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$rc"
