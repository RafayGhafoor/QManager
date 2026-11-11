#!/bin/sh
# check.sh — Auth status check (used by login page for setup detection).
_SKIP_AUTH=1
. /usr/lib/qmanager/cgi_base.sh

qlog_init "cgi_auth_check"
cgi_headers

# Responses are printed, not composed with `jq -n`: this endpoint is on the
# critical path of every pre-auth page load, and here `jq` only ever turned
# three known scalars into JSON. Everything below is a literal or a number that
# has already been range-checked, so nothing needs escaping - the ONE thing a
# composer would buy us. (Measured on the target box: one `jq` startup is
# 0.15-0.20 s of user CPU in situ.)
if is_setup_required; then
    printf '{"authenticated":false,"setup_required":true}\n'
    exit 0
fi

_token=$(qm_get_cookie "$COOKIE_SESSION")
if [ -n "$_token" ] && qm_validate_session "$_token"; then
    printf '{"authenticated":true}\n'
    exit 0
fi

# Lets the login page disable its button during a lockout instead of
# offering a submit that would just 429. Must stay on the READ-ONLY
# qm_get_rate_limit_status: qm_check_rate_limit mutates the attempts file,
# so a refresh during a lockout would engage or extend it.
if qm_get_rate_limit_status; then
    _rate_limited="false"
else
    _rate_limited="true"
fi

# The two counters go straight into JSON, so they must be plain integers: an
# empty or non-numeric value from the rate-limit helpers would emit invalid
# JSON, which no `--argjson` would have allowed. Guard, then print.
case "$RATE_LIMIT_RETRY_AFTER" in
    ''|*[!0-9]*) _retry=0 ;;
    *) _retry=$RATE_LIMIT_RETRY_AFTER ;;
esac
case "$RATE_LIMIT_ATTEMPTS_REMAINING" in
    ''|*[!0-9]*) _remaining=0 ;;
    *) _remaining=$RATE_LIMIT_ATTEMPTS_REMAINING ;;
esac
printf '{"authenticated":false,"rate_limited":%s,"retry_after":%s,"attempts_remaining":%s}\n' \
    "$_rate_limited" "$_retry" "$_remaining"
