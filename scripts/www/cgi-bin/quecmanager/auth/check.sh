#!/bin/sh
# check.sh — Auth status check (used by login page for setup detection).
_SKIP_AUTH=1
. /usr/lib/qmanager/cgi_base.sh

qlog_init "cgi_auth_check"
cgi_headers

if is_setup_required; then
    printf '%s\n' '{"authenticated":false,"setup_required":true}'
    exit 0
fi

_token=$(qm_get_cookie "$COOKIE_SESSION")
if [ -n "$_token" ] && qm_validate_session "$_token"; then
    printf '%s\n' '{"authenticated":true}'
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

# Emitted with printf rather than jq -n: jq startup costs ~0.46s of CPU on the
# SoCs this runs on, and this endpoint is hit on every login-page refresh.
# Both values are integers, so they are sanitised first - a malformed value
# would otherwise emit invalid JSON (jq would instead fail outright and return
# no body at all, so this is strictly more robust).
case "${RATE_LIMIT_RETRY_AFTER:-0}" in
    ''|*[!0-9]*) _rl_retry=0 ;;
    *)           _rl_retry="$RATE_LIMIT_RETRY_AFTER" ;;
esac
case "${RATE_LIMIT_ATTEMPTS_REMAINING:-0}" in
    ''|*[!0-9]*) _rl_remaining=0 ;;
    *)           _rl_remaining="$RATE_LIMIT_ATTEMPTS_REMAINING" ;;
esac

printf '{"authenticated":false,"rate_limited":%s,"retry_after":%s,"attempts_remaining":%s}\n' \
    "${_rate_limited:-false}" "$_rl_retry" "$_rl_remaining"
