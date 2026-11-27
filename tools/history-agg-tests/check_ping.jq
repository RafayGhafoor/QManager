# check_ping.jq - shape validation of a PingHistoryRanged (types/ping-history.ts).
def isnum: type == "number";
def numnull: . == null or isnum;
def chk(c; m): if c then empty else m end;
[
  chk(.success == true; "success"),
  chk(.range | IN("1h","6h","24h","7d"); "range"),
  chk((.bucket_sec | isnum) and (.generated_at | isnum); "bucket_sec/generated_at"),
  chk((.window | keys | sort) == ["end","start"] and .window.end == .generated_at; "window"),
  chk(all(.points[]; (.ts | isnum) and (.n | isnum) and .n > 0 and (.ok | isnum) and .ok <= .n and (.avg | numnull) and (.min | numnull) and (.max | numnull)
      and (.jit | numnull) and (.loss | isnum) and .loss >= 0 and .loss <= 100
      and ((.ok == 0) == (.avg == null))); "points (n>0, loss number, avg null iff nothing answered)"),
  chk(([.points[].ts]) as $t | $t == ($t | sort) and (($t | unique | length) == ($t | length)); "points ascending, unique"),
  chk(all(.points[]; .ts % 60 == 0); "bucket-aligned"),
  chk(all(.restarts[]; (.boot_ts | isnum) and (.last_alive_ts | numnull) and (.down_sec | numnull) and (.cause | IN("power_loss","restart","planned","unknown"))); "restarts"),
  chk(.device_utc_offset_min | isnum; "device_utc_offset_min")
]
