#!/bin/sh
# make_synth.sh <outdir> <days> <now_epoch> [l1=1] - a synthetic v2 archive for timing.
#
# <days> UTC day files ending at the day of <now_epoch> (today's file holds only
# the rows up to now). Days other than today and yesterday are gzipped, as the
# recorder's hourly pass leaves them. A matching ping archive goes to
# <outdir>/ping/ (14 days). Deterministic: the same arguments give the same bytes.
out="$1"; days="$2"; now="$3"; l1="${4:-1}"
[ -n "$out" ] && [ -n "$days" ] && [ -n "$now" ] || { echo "usage: make_synth.sh outdir days now [l1]" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out/cell" "$out/ping"
today=$((now / 86400))
i=0
while [ "$i" -lt "$days" ]; do
    d=$((today - i))
    name=$(awk -v d="$d" 'BEGIN { z = d + 719468; era = int(z / 146097); doe = z - era * 146097; yoe = int((doe - int(doe / 1460) + int(doe / 36524) - int(doe / 146096)) / 365); y = yoe + era * 400; doy = doe - (365 * yoe + int(yoe / 4) - int(yoe / 100)); mp = int((5 * doy + 2) / 153); dd = doy - int((153 * mp + 2) / 5) + 1; m = (mp < 10) ? mp + 3 : mp - 9; if (m <= 2) y++; printf "%04d-%02d-%02d", y, m, dd }')
    rows=1440
    [ "$i" -eq 0 ] && rows=$(( (now - d * 86400) / 60 ))
    sh "$here/gen.sh" v2 $((d * 86400)) "$rows" $((i + 11)) "$l1" > "$out/cell/$name.jsonl"
    if [ "$i" -lt 14 ]; then
        sh "$here/gen.sh" ping $((d * 86400)) "$rows" $((i + 3)) > "$out/ping/$name.jsonl"
    fi
    if [ "$i" -ge 2 ]; then
        gzip -f "$out/cell/$name.jsonl"
        [ -f "$out/ping/$name.jsonl" ] && gzip -f "$out/ping/$name.jsonl"
    fi
    i=$((i + 1))
done
