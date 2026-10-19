# Prometheus metrics endpoint + settings page (plan)

Route: `/monitoring/prometheus` (lucide page, Material sidebar glyph). Base: `development-home` `24eed7cd`. Size: **Large** (new unauthenticated-by-cookie endpoint, a poller tier-selection change, UCI schema, installer and config backup). Ledger: new row **B3.7** (new feature, target-only surface; follows every canon rule like the U4.11 rows).

## 1. Goal

Let a Prometheus server scrape the modem's signal, carrier aggregation, connectivity and device health over HTTP with a bearer token, configured from one card. Opt-in, off by default. No new binary, daemon or port: one shell CGI and one `jq` pass over the poller's snapshot. A "Scrape freshness" setting decides whether scrapes may hold the adaptive poller at a faster cadence.

## 2. Recon findings (2026-10-19)

**Live modem (read-only).**
- `/tmp/qmanager_status.json` is about 3.9 KB with 206 scalar paths. `jq` projection to exposition text takes about 16 ms. A full uhttpd round trip (overview.sh) takes about 58 ms. The device has 4 cores, is about 95 % idle and has about 320 MB free.
- uhttpd runs `-n 3` (3 concurrent requests), `-t 60`, `-R` (rfc1918 filter) on `:80` and `:443` (self-signed `/etc/uhttpd.crt`). The `/usr/sbin/uhttpd` binary contains the string `HTTP_AUTHORIZATION`, so the header very likely reaches CGIs. No QManager script reads it today. Step 0 confirms it.
- fw4: `wan` / `wan_all` input is REJECT. The vendor's `Allow-TCP-Input` / `Allow-TCP-v6-Input` from `wan_all` exist but are `enabled='0'`. The `tailscale0` input jumps to `accept_from_tailscale`, so tailnet peers reach `:80`. LAN zones are ACCEPT.
- `.timestamp` and `.last_successful_poll` are written every 2 s cycle in every tier, so `now - .timestamp` only shows that the poller is alive. It says nothing about how old the radio data is. In deep tier only `AT+QENG` runs (every `deep_idle_interval`, 120 s on the test modem). `carrier_components` (QCAINFO) and `signal_per_antenna` keep their last-known values **indefinitely** in deep (Invariant 7). An honest exporter needs per-source read ages (Decision D4).
- `quecmanager.poller`: enabled=1, active_grace=20, idle_interval=30, idle_threshold=300, deep_idle_interval=120. The current tier is active.
- **A B5.29 12-hour soak is running** (`/usrdata/b529_mon/bin/soakd.sh`, poller md5 `c6492f30…`). Poller deploys wait for it to finish (about 22:30 on 2026-10-19). The endpoint and settings CGI can deploy before then: an unmodified poller ignores the scrape file.
- Sentinels: per-antenna RSRP `-140` / `-32768`, RSRQ `-32768`, SINR `-20` / `-32768` mean "not reported" (`docs/features/antenna-alignment.md`). LTE SCC `sinr` is the modem's own reported `0` (raw field 10 of `+QCAINFO`). It is emitted as reported and documented as a caveat.

**Code.**
- Tier decision: `poll_cycle()` in `scripts/usr/bin/qmanager_poller` lines 2634–2701. The heartbeat branch (`else`, 2659) reads `/tmp/qmanager_ui_active` with a builtin `read` and measures age on the monotonic clock (`_MONO_TOP - _HB_SEEN_MONO`). The age then picks the tier: `≤ AP_ACTIVE_GRACE` active, `≤ AP_IDLE_THRESHOLD` idle, otherwise deep. The force flags and `AP_ENABLED=0` short-circuit to active before this branch. `write_cache` runs after the AT block on every path (the Invariant 1 shape is untouched by this plan).
- Composer: `_wc_compose_pf` (`_kS` / `_kN`, about line 1937 onwards; `.device` ends with `_kS poller_tier`, line 2064) and the jq safety-net composer `write_cache_jq` (`--arg ap_tier`, line 2219; `poller_tier: $ap_tier`, line 2327). The two must stay equal (`tools/poller-parity/status_parity.sh`).
- Auth helpers already exist in `cgi_auth.sh`: `qm_generate_token` (32 urandom bytes → sha256 hex, 64 chars) and `qm_timing_safe_compare` (awk, values passed on stdin by the `printf` builtin, never on argv). `_SKIP_AUTH=1` skips `require_auth`. `cgi_headers` hard-codes JSON and `Access-Control-Allow-Origin: *`, so the scrape endpoint writes its own headers.
- Lifecycle: `build.sh` and `install_tree` pick up new CGI subdirectories automatically. `install_dir_flat` skips subdirectories under `usr/lib/qmanager`. `seed_uci_defaults()` (install.sh:951) is the one seeding function and uses a key-by-key guarded pattern. The OTA path runs `install.sh --skip-packages`, so the seed covers upgrades. `uninstall.sh` deletes the whole `quecmanager` UCI package and `/var/run/qmanager`, so it needs no change (cross-checked).
- Redaction: `qmanager_debug_report` `redact_uci` (`*token*` glob) and `qmanager_health_check` `_redact_tree` (`option … token …` and `"…token…":` patterns) already redact an option named `token`. **The option must be named `token`** to stay covered.
- Config backup has no secret exclusion mechanism (`config_backup_sections.sh` copies values verbatim; `sms_alerts.recipient_phone` is included unredacted).
- Frontend: sidebar `components/app-sidebar.tsx` `navMonitoring` (Material glyphs; `stacked_line_chart` is already in the vendored subset). The settings pattern is `hooks/use-watchdog-settings.ts` (`authFetch`, `resolveErrorMessage`). Primitives exist: `SegmentedField` (required `glyph`), `CardFoot`, `SaveButton` + `useSaveFlash`, `Badge` (info / muted), `HintIcon`, `copyText`, `AlertDialog`. The simplest CardFoot + SegmentedField + toast reference is `components/system-settings/ssh-password-card.tsx`. There is no code-block component; the snippet is a small local `<pre>`.

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Endpoint** `GET /cgi-bin/quecmanager/metrics/prometheus.sh` (own folder, `_SKIP_AUTH=1`, own bearer check). **Settings** `GET/POST /cgi-bin/quecmanager/monitoring/prometheus.sh` (cookie auth via `cgi_base.sh`). | Not under `public/`: that folder is the documented "entire unauth surface" with no secret. Keeping the scrape path apart from the settings CGI keeps the cookie-auth and token-auth code paths from mixing. |
| D2 | **Strict allowlist projection** written as named `jq` families (Section 5). Never a generic flattener. A missing reading **omits the series** (no `NaN`). | Omission is the Prometheus convention: a vanished series goes stale. `NaN` poisons `avg()` / `min()` and draws false gaps as values. The allowlist means a new snapshot field is never exported by accident. |
| D3 | **One indistinguishable denial**: disabled, setup required, missing token, malformed token and wrong token all return `403 Forbidden` with the same headers and body, after the same compare work (a disabled or empty stored token is compared against a fixed dummy). | Doesn't reveal whether the feature is on. Prometheus shows "403", which the owner resolves from the card. (Agreed design said 404 or 403; this picks one for every case.) |
| D4 | **Add two poller fields**: `.device.serving_read_mono` (uptime s of the last successful `AT+QENG` parse) and `.device.ca_read_mono` (last successful `AT+QCAINFO` parse); 0 means never. The exporter turns them into `qmanager_serving_cell_age_seconds` and `qmanager_carrier_components_age_seconds`. | Without them every radio gauge looks fresh while deep tier freezes CA data for hours. Cost: two assignments plus two composer keys, no forks. **Deviation from the agreed design**; it can be dropped (Open question 1) and the plan still works with only `qmanager_snapshot_age_seconds`. |
| D5 | **Scrape file instead of a bare lease**: every *authenticated* scrape (all modes) writes `/var/run/qmanager/metrics_scrape` = `"<freshness> <uptime_s>\n"` with `qm_atomic_write`. The poller holds a tier only when freshness is `balanced` / `realtime` and `0 ≤ _MONO_TOP − uptime_s ≤ 120`. | One file serves both the hold and the card's "Last scrape" fact. Writing uptime (monotonic) instead of epoch makes the age immune to NITZ and ntpd steps with no seen-change tracking. Only an authenticated scrape renews it, so an unauthenticated flood can't pin the poller. `/var/run` is tmpfs and the file dies with a reboot, just as the uptime clock resets. |
| D6 | **Hold TTL 120 s** (`METRICS_LEASE_TTL` constant in the poller, not UCI). | Covers Prometheus' default 1 m scrape interval with one missed scrape. The card hint says freshness holds only while Prometheus scrapes at least once a minute. Back-off resumes at most 120 s after the last scrape. |
| D7 | **Hold = rewrite the effective age**, not the tier ladder: `realtime` → `_age=0`; `balanced` → `_age=min(_age, AP_IDLE_THRESHOLD)`. | The existing ladder, AT-due modulo and full-refresh logic stay exactly as they are. Balanced lands in idle (data at most `idle_interval` old, QCAINFO and per-antenna included). Real-time lands in active like an open browser. |
| D8 | **Token**: 64 hex from `qm_generate_token`, stored in UCI `quecmanager.metrics.token`. Generated on first enable and by a Regenerate action, written with `uci batch` on stdin (never on argv). Never seeded by the installer. **Excluded from config backup.** | The UI must be able to show it again, so it is stored in plain text (root-only device). Keeping it out of backups means a shared backup file can't scrape anyone's modem. After a restore onto a device with no token, the apply generates a fresh one (Open question 2). |
| D9 | **No failed-token throttling.** Log a failure at most once per 60 s (`metrics_authfail.stamp` mtime) with `REMOTE_ADDR` only, never the header. | 256-bit tokens make brute force moot. A lockout file would let any LAN host lock out the real scraper. uhttpd `-n 3` already bounds concurrency. |
| D10 | **Identifiers never exported** (IMEI, IMSI, ICCID, phone, WAN/DNS IPs, MACs, APN, ping target, profile names). **Cell identity** (cell_id, eNB, sector, TAC, timing advance) is **excluded in v1**. The opt-in `include_cell_identity` is specified in Section 4 but not built (Open question 3). PCI, EARFCN/ARFCN, band and carrier name **are exported**. | See Section 4. PCI is reused every few km and EARFCN is a frequency, so on their own they don't locate a device, and the per-carrier series need them as labels. Cell ID + TAC + TA locate a device to a sector and a distance. |
| D11 | **Snapshot stale (> 30 s on `.mono`, the watchdog's `STATUS_STALE_THRESHOLD`) or missing** → 200 with only `qmanager_snapshot_up 0`, the age, and `qmanager_build_info`; no radio or connectivity series. | Never serve frozen numbers as live. `up` stays 1 because the exporter itself answered. |
| D12 | **Snippet uses `https` with `insecure_skip_verify: true`** and the page's own host. A `HintIcon` says the modem's certificate is self-signed, and plain `http` is fine over Tailscale. | Over plain HTTP the bearer crosses the LAN in clear. Over HTTPS with a self-signed cert it resists passive sniffing; MITM is out of scope on a LAN. |
| D13 | **No System Health Check entry** in v1. **No `init.d` change** (the scrape file stays valid across a poller restart because it is keyed on uptime). | Nothing can drift except UCI, and adding a check touches the runner, `shapes.ts` counts and 5 catalogs for little value. |
| D14 | **No-Debug-Build-Copy exception**: the card legitimately shows the endpoint URL and a scrape config, because the surface exists to integrate a tool, like the AT Terminal. That text appears only inside the snippet block and the URL field, never in prose. No UCI, file, daemon or script names anywhere. | Add "Prometheus (endpoint URL and scrape config)" to the exception lists in `DESIGN.md` (line 882) and `CLAUDE.md`. |

## 4. Data classification (every snapshot field)

Default: **excluded**. Anything not listed as exposed below is never emitted.

| Class | Fields | Exposed as |
|---|---|---|
| **Exposed** | `modem_reachable`, `mono`, `timestamp` (age only), `system_state` (stateset) | gauges |
| Exposed | `network.type`, `.carrier`, `.service_status`, `.cfun`, `.total_bandwidth_mhz`, `.carrier_components[].{type,technology,band,earfcn,bandwidth_mhz,pci,rsrp,rsrq,rssi,sinr}` | info + labelled gauges |
| Exposed | `lte.{state,band,earfcn,pci,rsrp,rsrq,rssi,sinr}`, `nr.{state,band,arfcn,pci,rsrp,rsrq,sinr,scs}` | gauges + `serving_cell_info` |
| Exposed | `signal_per_antenna.*[]` (sentinels dropped) | labelled gauges |
| Exposed | `connectivity.{internet_available,latency_ms,avg_latency_ms,jitter_ms,packet_loss_pct,dns_lookup_ms,status}` | gauges / stateset |
| Exposed | `device.{temperature,cpu_usage,memory_used_mb,memory_total_mb,uptime_seconds,conn_uptime_seconds,poller_tier,model,firmware,manufacturer,qmanager_version}` + new `serving_read_mono`, `ca_read_mono` | gauges, `build_info` |
| Exposed | `watchcat.{enabled,failure_count,total_recoveries}`, `sim.status` (stateset of known values) | gauges |
| **Opt-in (designed, not built in v1)** | `lte.{cell_id,enodeb_id,sector_id,tac,ta}`, `nr.{cell_id,enodeb_id,sector_id,tac,ta}` | would be `qmanager_serving_cell_identity_info{…}` behind `quecmanager.metrics.include_cell_identity=1`, with a visible consequence line ("Prometheus can work out roughly where the modem is") |
| **Never** | `device.{imei,imsi,iccid,phone_number,ippt_*}`, `network.{wan_ipv4,wan_ipv6,apn,primary_dns*,secondary_dns*,sim_slot}`, `connectivity.{ping_target,dns_resolver,last_family,latency_history,thresholds,profile,…}`, `sim_swap.*` (user-entered profile names), `sim_failover.*`, `errors`, band-support strings (`supported_*`, `hw_*`, `lte_category`, `mimo`, `bandwidth_details`, `build_date`), `watchcat.{last_recovery_time,…}`, `network.{ca_active,ca_count,nr_ca_active,nr_ca_count}` (replaced by a count derived from the array) | — |

Why "never" rather than opt-in for identifiers: Prometheus keeps data for long periods and is often federated to cloud services (Grafana Cloud). Subscriber and equipment identifiers aren't telemetry, and no dashboard needs them.

## 5. Metric catalog

All families are `gauge`, each with `# HELP` / `# TYPE` lines, samples grouped by family, `Content-Type: text/plain; version=0.0.4; charset=utf-8`. Units follow Prometheus base units, except the logarithmic radio units (`_dbm`, `_db`), which have no base unit.

| Metric | Labels | Source / transform |
|---|---|---|
| `qmanager_snapshot_up` | — | 1 if the snapshot exists, parses and is fresh (D11) |
| `qmanager_snapshot_age_seconds` | — | `uptime − .mono`; fallback `now − .timestamp` |
| `qmanager_serving_cell_age_seconds` | — | `uptime − .device.serving_read_mono` (omit if 0 / absent) — D4 |
| `qmanager_carrier_components_age_seconds` | — | `uptime − .device.ca_read_mono` — D4 |
| `qmanager_build_info` | `version`, `model`, `manufacturer`, `firmware` | constant 1 |
| `qmanager_poller_tier` | `tier` = active / idle / deep | stateset (1 for current, 0 others) |
| `qmanager_scrape_freshness` | `mode` = adaptive / balanced / realtime | stateset, from UCI |
| `qmanager_modem_reachable` | — | bool → 1/0, null omitted |
| `qmanager_system_state` | `state` = normal / scan_in_progress / … | info (value 1) |
| `qmanager_modem_cfun` | — | number |
| `qmanager_network_info` | `network_type`, `carrier`, `service_status` | 1 |
| `qmanager_total_bandwidth_hertz` | — | `total_bandwidth_mhz × 1e6` |
| `qmanager_carrier_components` | `rat` = lte / nr | count of array entries by technology |
| `qmanager_carrier_{rsrp_dbm,rsrq_db,rssi_dbm,sinr_db}` | `rat`, `role` (pcc/scc), `band`, `pci`, `earfcn` | per CC; deduplicated `unique_by` on the label tuple so a duplicate can never fail the scrape |
| `qmanager_carrier_bandwidth_hertz` | same | `bandwidth_mhz × 1e6` |
| `qmanager_serving_{rsrp_dbm,rsrq_db,sinr_db}` | `rat` | `.lte.*` / `.nr.*` (stable series for dashboards) |
| `qmanager_serving_rssi_dbm` | `rat="lte"` | `.lte.rssi` |
| `qmanager_serving_cell_info` | `rat`, `state`, `band`, `pci`, `earfcn` (`arfcn` for NR), `scs_khz` (NR) | 1 |
| `qmanager_antenna_{rsrp_dbm,rsrq_db,sinr_db}` | `rat`, `port` = prx / drx / rx2 / rx3 | `signal_per_antenna`, sentinels dropped |
| `qmanager_internet_up` | — | `connectivity.internet_available` |
| `qmanager_connectivity_status` | `status` | info |
| `qmanager_ping_rtt_seconds` / `_avg_seconds` / `qmanager_ping_jitter_seconds` | — | ms ÷ 1000 |
| `qmanager_ping_loss_ratio` | — | `packet_loss_pct ÷ 100` |
| `qmanager_dns_lookup_seconds` | — | `dns_lookup_ms ÷ 1000` |
| `qmanager_temperature_celsius` | — | `device.temperature` |
| `qmanager_cpu_usage_ratio` | — | `cpu_usage ÷ 100` |
| `qmanager_memory_{used,total}_bytes` | — | MB × 1048576 |
| `qmanager_system_uptime_seconds` / `qmanager_connection_uptime_seconds` | — | device fields |
| `qmanager_watchdog_enabled` / `_failure_count` / `_recoveries` | — | `watchcat.*` (`_recoveries` is a gauge: it can reset) |
| `qmanager_sim_status` | `status` | info |

**Label escaping (no regex on device jq).** One `def lbl:` applied to every label value: `tostring | explode | map(select(. >= 32 and . != 127)) | implode | .[0:64] | split("\\") | join("\\\\") | split("\"") | join("\\\"")`. Control characters (including `\n` and `\r`) are dropped rather than escaped, so a value can never end a line. `split/1` with a string is not a regex in jq 1.6. Numbers are emitted only when `type == "number"`; strings go through `tonumber?` where the snapshot stores numbers as strings. Why: `carrier` comes from `AT+COPS?`, which a rogue cell can set to any string.

## 6. UCI schema

```
quecmanager.metrics=metrics
quecmanager.metrics.enabled='0'          # 0|1
quecmanager.metrics.freshness='adaptive' # adaptive|balanced|realtime
quecmanager.metrics.token=''             # 64 hex; never seeded; generated on first enable / regenerate
# designed, not built in v1: quecmanager.metrics.include_cell_identity='0'
```
Readers treat a missing section, a missing key or an invalid value as the default (enabled=0, freshness=adaptive). A token that is not exactly 64 lowercase hex is treated as no token (fail closed).

## 7. Contracts

### 7.1 `GET metrics/prometheus.sh` (scrape)
- Request: `Authorization: Bearer <64 hex>`. Any other method → `405` with `Allow: GET`.
- Order of work:
  1. `_SKIP_AUTH=1`, source `cgi_base.sh` (for `qm_timing_safe_compare`, `is_setup_required`, `safe_tmp.sh`).
  2. Copy the header into a local, then `unset HTTP_AUTHORIZATION` so forked children don't inherit it.
  3. One `uci -q show quecmanager.metrics` fork, parsed with shell expansions.
  4. Validate the presented token by `case` (64 chars, `[0-9a-f]` only).
  5. Always run one `qm_timing_safe_compare` (against the stored token, or a fixed dummy when disabled / unset / malformed).
  6. Any failure → the uniform 403 (D3).
- Success: `200`, `Content-Type: text/plain; version=0.0.4; charset=utf-8`, `Cache-Control: no-store`. **No CORS headers.**
  1. Read uptime with a builtin `read` of `/proc/uptime`.
  2. Write the scrape file (D5) with `qm_run_dir` + `qm_atomic_write`; a write failure doesn't fail the scrape.
  3. Run `jq -r --argjson up "$uptime" --arg mode "$freshness" -f <inline program>`.
- **Must not** touch `/tmp/qmanager_ui_active`, read POST, or log the header or token.
- Budget: one each of `uci`, `awk`, `jq`, `mktemp` and `mv`; target ≤ 80 ms round trip.

### 7.2 `GET monitoring/prometheus.sh` (settings)
```json
{ "success": true,
  "settings": { "enabled": false, "freshness": "adaptive", "token": "" },
  "endpoint_path": "/cgi-bin/quecmanager/metrics/prometheus.sh",
  "last_scrape": { "age_seconds": 12, "mode": "realtime" },
  "holding": true,
  "poller": { "adaptive_enabled": true, "tier": "active" } }
```
- `last_scrape` is `null` when there is no valid scrape file.
- `holding` = enabled AND file mode in {balanced, realtime} AND age ≤ 120.
- `poller.adaptive_enabled` comes from `quecmanager.poller.enabled` (absent means true). `tier` comes from `.device.poller_tier`.
- `token` is returned to the authenticated owner; `cgi_headers` already sends `no-store`.

### 7.3 `POST monitoring/prometheus.sh`
- `{"action":"save","enabled":true,"freshness":"balanced"}`:
  - Validates both fields. Generates a token when enabling with none.
  - Applies one `uci batch` (stdin) and commits.
  - Rewrites the scrape file's mode, keeping its uptime (or removes the file when disabling), so a mode change takes effect within one poller cycle.
  - Returns the GET body.
- `{"action":"regenerate_token"}`: new token via `uci batch`, returns the GET body. Allowed only while enabled; otherwise `invalid_value`.
- Errors (`cgi_error`): `no_body`, `missing_action`, `unknown_action`, `invalid_value` (with `detail` = field), `token_generation_failed` (**new code**; add to `errors.json` ×5), `save_failed` (uci commit failed; reuse if present, otherwise new ×5), `method_not_allowed`.
- Nothing is logged with the token. The no-reload contract holds: the endpoint reads UCI per request and the poller reads the file, so no daemon restart and no reload flag.

## 8. Poller change (Opus; the risky part)

1. **Constants** near `UI_ACTIVE_FILE`: `METRICS_SCRAPE_FILE="/var/run/qmanager/metrics_scrape"`, `METRICS_LEASE_TTL=120`.
2. **Hold, inside the heartbeat `else` branch, after `_age` is computed (after line 2683) and before the ladder (2685).** Builtins only, separate `local` lines:
```sh
local _ms_mode
local _ms_up
_ms_mode=""
_ms_up=""
if [ "$_MONO_TOP" -gt 0 ]; then
    { read -r _ms_mode _ms_up < "$METRICS_SCRAPE_FILE"; } 2>/dev/null
    # digits only, no leading zero (ash aborts on $((08))), at most 10 digits
    case "$_ms_up" in ''|*[!0-9]*|0?*|???????????*) _ms_mode="" ;; esac
    if [ -n "$_ms_mode" ] && [ "$_ms_up" -le "$_MONO_TOP" ] \
       && [ $((_MONO_TOP - _ms_up)) -le "$METRICS_LEASE_TTL" ]; then
        case "$_ms_mode" in
            realtime) _age=0 ;;
            balanced) [ "$_age" -gt "$AP_IDLE_THRESHOLD" ] && _age="$AP_IDLE_THRESHOLD" ;;
        esac
    fi
fi
```
   Per-cycle cost: one `open`/`read`/`close` of a ≤ 32-byte tmpfs file (or one failed `open` when absent), two `case`s and one arithmetic expansion. Zero forks. It runs only on the heartbeat path (adaptive on, not forced). `AP_ENABLED=0`, the force flags and the scan / SIM-switch early return are unaffected. `write_cache` and `read_ping_data` are untouched (Invariant 1). No parser touched, so the `parity.sh` gate stays N/A.
3. **D4 fields:**
   - Set `_SERVING_READ_MONO="$_MONO_TOP"` in `poll_serving_cell` right after a successful `parse_serving_cell` (line 965 path).
   - Set `_CA_READ_MONO="$_MONO_TOP"` right after `parse_ca_info "$_QR"` (line 2741).
   - Initialise both to 0 at the top.
   - Emit `_kN serving_read_mono "$_SERVING_READ_MONO" 0` and `_kN ca_read_mono …` before `_kS poller_tier` in `_wc_compose_pf`, and the matching `--argjson` keys in `write_cache_jq`.
   - `status_parity.sh` must pass (the composer gate).
4. **Doc invariant (adaptive-polling.md, new Invariant 11):** the scrape file is a third tier input after the force flags and the heartbeat. It can only raise the cadence (an age rewrite), never lower it, it expires on its own, and it is ignored when `/proc/uptime` is unreadable.

## 9. File list

**New**
| File | Intent |
|---|---|
| `scripts/www/cgi-bin/quecmanager/metrics/prometheus.sh` | Scrape endpoint (7.1), inline jq program (Section 5) |
| `scripts/www/cgi-bin/quecmanager/monitoring/prometheus.sh` | Settings GET/POST (7.2 / 7.3) |
| `app/monitoring/prometheus/page.tsx` | Thin route wrapper |
| `components/monitoring/prometheus/prometheus.tsx` | Page coordinator: `MonitoringPageHeader`; skeleton / error `ConditionBlock` with Retry / loaded |
| `components/monitoring/prometheus/prometheus-card.tsx` | The one Card (Section 10) |
| `components/monitoring/prometheus/scrape-config.tsx` | `<pre>` YAML block (mono) + Copy; masked token in view, real token in the copied text |
| `components/monitoring/prometheus/shapes.ts` | Geometry constants the skeleton imports |
| `hooks/use-prometheus-metrics.ts` | GET (re-poll every 15 s while visible, for last-scrape / holding) + `save` / `regenerateToken` returning `MutationResult` (returned code → `resolveErrorMessage`) |
| `types/prometheus-metrics.ts` | `MetricsFreshness`, settings, GET response types |
| `docs/features/prometheus-metrics.md` | Feature doc (contracts, classification, invariants, gotchas) |

**Modified**
| File | Change |
|---|---|
| `scripts/usr/bin/qmanager_poller` | Section 8 |
| `scripts/install.sh` | `seed_uci_defaults`: section, `enabled=0`, `freshness=adaptive` (key-guarded; never `token`) |
| `scripts/usr/lib/qmanager/config_backup_sections.sh` | New `metrics` section: collect `enabled`, `freshness` only; apply them and generate a token if enabled with none. Register it in `CFG_BACKUP_APPLY_ORDER` and both dispatch cases. |
| `scripts/usr/bin/qmanager_config_restore` | `section_label` entry |
| `types/config-backup.ts`, `lib/config-backup/sections.ts` (+ `sections.test.ts`) | New `metrics` key |
| `components/app-sidebar.tsx` | `{ t_key: "prometheus", url: "/monitoring/prometheus", icon: "stacked_line_chart" }` after NetBird |
| `public/locales/{en,zh-CN,zh-TW,it,id}/monitoring.json` | `prometheus.*` |
| `…/sidebar.json` | `items.prometheus` |
| `…/errors.json` | `token_generation_failed` (+ `save_failed` if new) |
| `…/system-settings.json` | `config_backup.sections.metrics` |
| `DESIGN.md`, `CLAUDE.md` | D14 exception; routing row in CLAUDE.md |
| `docs/features/README.md`, `docs/API-REFERENCE.md`, `docs/FRONTEND.md`, `docs/features/adaptive-polling.md`, `docs/features/config-backup-restore.md`, `docs/rm520n-port-ledger.md` (B3.7), `RELEASE_NOTE.md` | Docs (step 6) |

Untouched on purpose: `uninstall.sh` (package and `/var/run/qmanager` already removed), `init.d/qmanager`, `qmanager_health_check`, `parse_at.sh`.

## 10. Card anatomy (canon)

One `Card` ("Prometheus metrics" + one-sentence description, no icon). It declares `@container/card` and recomposes at `@5xl/card:` into settings on the left and the scrape config on the right. No `max-w`. Lucide glyphs only; the sidebar entry uses the Material glyph per the icon boundary.

Receipt rows:
1. **Endpoint** — `SegmentedField` Off / On (`breakpoint="never"`).
2. **Scrape freshness** — `SegmentedField` Adaptive / Balanced / Real-time, with one `HintIcon` (the scrape-interval caveat).
   - The consequence line under the row is always visible: Balanced = "Readings stay under {idle_interval} s old while Prometheus scrapes." Real-time = "The modem is read every 2 seconds while Prometheus scrapes, like an open dashboard."
   - When `poller.adaptive_enabled=false`: a filled `Badge variant="info"` "Adaptive polling is off, so readings are always live" (Fact-Is-Info). The field stays editable (its value takes effect if adaptive polling is turned back on). No second poller toggle.
3. **Status facts** (Fact-Is-Info, only while they apply):
   - `info` "Last scrape 12 s ago" with a lucide `Activity` glyph.
   - `info` "Holding polling" (`Gauge`) while `holding`.
   - `muted` "No scrapes yet" (`CircleDashed`). Every state has its own glyph.
4. **Token** (shown when enabled and set):
   - Masked mono string, a Show / Hide ghost toggle, and Copy (`copyText`, toast).
   - Regenerate (`tonal-neutral`) behind an `AlertDialog` whose visible consequence reads "Prometheus can't scrape until you paste the new token into its config." This is an operational action, exempt from CardFoot. It toasts.
5. **Scrape config** — YAML: `job_name: qmanager`, `scheme: https`, `metrics_path`, `authorization: {type: Bearer, credentials: <token>}`, `tls_config: {insecure_skip_verify: true}`, `static_configs.targets: [<window.location.hostname>:443]`. Copy (toast). One `HintIcon` covers the self-signed and Tailscale `http` notes.

`CardFoot`: status "Unsaved changes" or the returned failure on the left; ghost Discard, then `SaveButton` (translated label) on the right. It saves `enabled` + `freshness`.

Toasts (one per finished mutation, handler-level, returned reason): save, regenerate, copy token, copy config. All copy goes through `t()` in 5 catalogs. Copy is grep-checked against `/etc/`, `/tmp/`, `uci `, `AT+`, `read back`, `saved to`. The endpoint path appears only inside the snippet.

## 11. Threat model

| Threat | Exposure | Mitigation | Residual |
|---|---|---|---|
| LAN attacker scrapes or probes | LAN zone input ACCEPT; uhttpd on 0.0.0.0 | Opt-in, off by default; 256-bit bearer; uniform 403 (D3); allowlist (Section 4) | A token holder sees radio telemetry, which is the purpose |
| WAN exposure | fw4 `wan` / `wan_all` REJECT; vendor TCP-input rules exist but are disabled; uhttpd `-R` rejects public→RFC1918 (but not public IPv6) | Token-gated regardless; doc warns never to enable the vendor WAN TCP rules | If a user enables the WAN rule, IPv6 reaches the 403 wall |
| Tailscale / NetBird peers | `tailscale0` input accepted | Token-gated; this is the supported remote-scrape path | — |
| Token brute force / timing | Unlimited unauth requests | 2^256 space; one compare on every path, including disabled (D3); constant-work awk compare; `-n 3` concurrency | Fork-time jitter dominates any timing signal |
| Token leakage: logs | qlog, syslog, uhttpd | Never log the header or token; auth-fail log keeps only `REMOTE_ADDR`, rate-limited (D9); uhttpd doesn't log request headers | — |
| Token leakage: argv / env | `/proc/*/cmdline`, `environ` | `uci batch` via stdin; compare via the `printf` builtin pipe; `unset HTTP_AUTHORIZATION` before forks | `environ` is root-readable only |
| Token leakage: backups, diagnostics | `.qmbackup`, debug report, health-check bundle | Excluded from the backup section (D8); option named `token` matches both existing redactors (verified) | — |
| Token leakage: UI | GET returns it to the owner | Cookie-auth only, `no-store`, masked by default | Shoulder-surfing when revealed |
| Token in transit | HTTP on the LAN | Snippet defaults to HTTPS (D12); Tailscale is WireGuard-encrypted | Self-signed cert means MITM-capable |
| Label / exposition injection | `carrier` from COPS (rogue-cell controllable), any string label | `lbl` filter: control characters dropped, `\` and `"` escaped, 64-char cap; numbers type-checked; families written by the jq program, never interpolated by shell | — |
| Scrape flood (DoS) | Unauth flood takes uhttpd slots, competing with the UI | Unauth path exits before `jq`; only authenticated scrapes renew the hold, so a flood cannot pin the poller | Slot contention, same as `overview.sh` today |
| Scrape-file planting | Poller trusts the file | Lives in root-only `/var/run/qmanager` (`qm_run_dir`); `qm_atomic_write`; poller parses defensively (allowlisted mode; digits only, no leading zero, ≤ 10 digits, not in the future); worst case only raises the cadence for ≤ 120 s | — |
| Disabled-state leak | Existence of the CGI file | The file ships on every install (open source); the enabled state is hidden by D3 | — |
| Poller pinned by Real-time 24/7 | Sustained active polling | Active tier no longer carries the data-plane reads (Invariant 6); the consequence is visible in the UI; default is Adaptive | Real-time 24/7 is a new usage pattern; measured in validation (CPU, SSR log) |

## 12. Build order (bottom-up; worktree reset onto `development-home`, `.env` copied)

**Step 0 — Header spike (main session, 5 min, live write with OK).** Deploy a throwaway CGI that prints only whether `HTTP_AUTHORIZATION` is non-empty. Curl it with a header, then delete it. If uhttpd doesn't pass the header, stop and come back: the fallback is a `?token=` query param (`params:` in Prometheus), which puts the secret in Prometheus' target URL.

**Step 1 — Backend, in parallel:**
- **A. Opus (medium):** the poller (Section 8) + `status_parity.sh` run. Deploy waits for the soak to finish.
- **B. Opus (medium, security-sensitive):** `metrics/prometheus.sh` + the jq program, tested on-device against fixture snapshots (normal, deep-tier stale, missing file, nulls, crafted carrier `a"b\c` + newline + `\r`).
- **C. Sonnet (high):** `monitoring/prometheus.sh` + `install.sh` seed + config backup (shell side, restore label).

**Step 2 — Validator** (static + on-device) on A, B and C. Up to 2 rounds, then ask.

**Step 3 — Frontend (main session via Impeccable craft, per the user's preference; can start in parallel with Step 1 against the fixed contract 7.2 / 7.3):** types → hook → card / snippet / coordinator → sidebar → config-backup frontend keys. Then i18n: en authored, it / id / zh-CN by a Sonnet translator, zh-TW from zh-CN via OpenCC s2twp.

**Step 4 — Security validation** (Section 13.3). An independent agent; fixes loop back to the builder.

**Step 5 — Preview** on the live CGI: 1440 / 375 px, light / dark, all states.

**Step 6 — Docs** (file list), ledger B3.7, release note.

## 13. Validation

### 13.1 Static
- `.claude/check-crlf.sh` on every touched shell file.
- `sh -n`.
- BusyBox / POSIX audit: no bashisms, no multi-var `local`, numeric guards before arithmetic, no `$( )` around shell functions in the poller.
- `jq`: no `test` / `match` / `sub` / `gsub`; null-safe `//`; `select(type=="number")`; `split/1` only.
- Lock / trap discipline: no new locks; atomic writes only.
- CGI envelope on the settings CGI.
- No reboot / CFUN anywhere.
- Grep the endpoint and settings CGI for `qlog.*(token|AUTH)`, which must find nothing.

### 13.2 On device (validator; backups `.bak` + md5 first; scp to `/tmp`, `mv`, `sync`)
1. **Endpoint:**
   - Disabled → 403.
   - Enable via the settings CGI (`modem_cgi`), then: no header → 403; malformed → 403; wrong 64-hex → 403; right → 200.
   - The body passes `promtool check metrics` on the dev PC (or `prometheus_client` text parser if promtool is absent).
   - Time 20 scrapes; p95 ≤ 100 ms.
2. **Heartbeat isolation:** `/tmp/qmanager_ui_active` mtime is unchanged across 10 scrapes.
3. **Tier behaviour** (close the browser; drive by `curl` from the PC; watch `.device.poller_tier` and `qmanager.log`):
   - Adaptive: scrape every 15 s for 7 min → reaches deep at the normal time.
   - Balanced, from deep: idle within 2 s of the first scrape; stop scraping → deep within 120 s + 2 s.
   - Real-time, from deep: active within 2 s; stop → falls back by heartbeat age within 120 s.
   - A mode change via save takes effect within one cycle.
   - Disable removes the scrape file.
4. **Robustness:** write garbage scrape files (`realtime 08`, `realtime abc`, `realtime 99999999999`, a future uptime, an empty file, `bogus 100`). The poller survives (pid stable, `.mono` advancing) and no hold happens.
5. **D4:** `serving_read_mono` advances every AT-due cycle. In deep, `ca_read_mono` freezes and `qmanager_carrier_components_age_seconds` grows.
6. **Gates:**
   - `tools/poller-parity/status_parity.sh` → all equal.
   - `measure.sh` active and deep 60 s windows: CPU within ±0.5 pt of the 4.92 % / 2.62 % baseline; period 2.0 ± 0.2 s.
   - Optional 1 h Real-time run with a 15 s scraper: watch `dmesg` for `remoteproc-mss` SSRs against the baseline.
7. **Lifecycle:**
   - Re-run `install.sh --skip-packages` on the device: the seed is idempotent and a user value is preserved.
   - Config backup round trip: no `token` in the archive; restore sets enabled / freshness and generates a token when absent.
   - Restore the user's original settings afterwards.

### 13.3 Security validation (mandatory, before the merge question)
An agent **independent of the builders** (Opus, security-focused; or `claude-security` scan in review mode on the diff) runs it.
- **Static review:**
  - Both CGIs, the jq program, the poller hold block, token generation and storage, the backup section and the redactor coverage.
  - Every path to output for allowlist completeness; header and argv handling; the uniform 403 (same headers, body and work).
- **On-device:**
  1. Scrape and grep the body for the **live** IMEI, IMSI, ICCID, phone number, WAN IPv4/IPv6, DNS IPs, APN, IPPT MAC, cell_id and TAC values read from `status.json` at test time. Expect zero hits.
  2. Grep for the token: `/tmp/qmanager.log*`, `logread`, `/tmp/qmanager_*.json`, `ps w` during a scrape and during a save, the config backup archive, the debug report and the health-check bundle. Expect zero hits.
  3. Reachability: `nft list ruleset` shows wan / wan_all input reject for 80 and 443. From a tailnet peer, no token gives 403 and the token gives 200. If a WAN-side test host is available, attempt `:80` / `:443` on the WAN address.
  4. Label injection:
     - In a `/tmp` harness, run the endpoint's jq program against a copy of `status.json` with `carrier` set to `x"} 1\nqmanager_pwned 1\n\\`. The live file is never edited.
     - Expect a single escaped label line, no `qmanager_pwned` series, and promtool clean.
  5. 403 uniformity: `curl -i` disabled vs wrong-token responses are byte-identical apart from `Date`.
  6. Flood: 200 unauthenticated requests at concurrency 3. The UI stays usable and the poller tier is unaffected.
- **Findings** are fixed by the owning builder and re-verified by the same security agent. The merge question waits until it reports clean.

### 13.4 Frontend
- `bunx tsc --noEmit`; eslint on touched files.
- `bun test lib/config-backup`; `bun run i18n:check` (0 / 0 across 5 locales); `bun run icons:check`; `bun run build`.
- Copy grep (D14).

## 14. Risks

- **Soak collision.** A poller deploy restarts the daemon mid-soak. Mitigation: deploy A only after `soakd.sh` exits; B and C can go first.
- **uhttpd drops `Authorization`.** Step 0 catches this before any build.
- **Real-time 24/7 load.** Mitigation: the default is Adaptive, the consequence is visible, and the optional SSR watch is in 13.2.
- **Composer drift.** D4 touches both composers. Mitigation: the `status_parity` gate. D4 can be dropped without touching anything else.
- **Duplicate series failing scrapes.** Mitigation: `unique_by` on CC labels; per-antenna ports are fixed.
- **Prometheus label churn on handover.** CC and serving-info series change with band, PCI or EARFCN. That is expected and documented, and the stable `qmanager_serving_*{rat}` series serve dashboards.
- **`-n 3` slots.** A scraper plus an open UI share three slots. Each scrape takes about 60 ms; documented.
- **Merge order.** The locale files are touched by other wave rows. Edit only the `prometheus` sub-tree and the single sidebar and error keys.

## 15. Rollback

- **Device:** restore `qmanager_poller.bak` (md5 check, `sync`, `/etc/init.d/qmanager restart`); `rm` both new CGIs; `uci delete quecmanager.metrics; uci commit`; `rm -f /var/run/qmanager/metrics_scrape`.
- **Repo:** revert the B3.7 merge commit.
- An old poller ignores the scrape file, so the endpoint and settings can stay while only the poller is rolled back.

## 16. Team

| Piece | Who | Parallel set |
|---|---|---|
| Plan, judging, Step 0, frontend craft | Main session (Opus) | — |
| Poller (Section 8) | Opus medium | A: `qmanager_poller` only |
| Scrape endpoint + jq | Opus medium | B: `metrics/prometheus.sh` |
| Settings CGI, installer seed, backup shell | Sonnet high | C: `monitoring/prometheus.sh`, `install.sh`, `config_backup_sections.sh`, `qmanager_config_restore` |
| Translations | Sonnet high (it / id / zh-CN) + OpenCC (zh-TW) | locale files |
| Validation | `validator` (Sonnet) | after A, B, C |
| Security validation | Independent Opus security reviewer / `claude-security` | after build, before merge |
| Docs | Main session inline (`docs-writer` only if it grows) | last |

The A, B and C file sets don't overlap, so no worktree isolation is needed between builders. Close: commit on the worktree branch and report branch and status. Never auto-merge; ask whether to merge, keep for a PR, or discard.

## 17. Open questions

1. **D4 poller fields:** add `serving_read_mono` / `ca_read_mono` (honest age gauges, touches both composers), or ship with only `qmanager_snapshot_age_seconds` and accept frozen CA values in deep tier?
2. **Token in config backup:** exclude it (recommended; restore generates a new one, and Prometheus needs the new token), or include it so a restore onto a replacement modem keeps scraping?
3. **Cell identity opt-in** (`include_cell_identity`: cell ID, eNB, sector, TAC, timing advance): build it now behind its own toggle and consequence line, or leave it designed but unbuilt (recommended)?
4. **Snippet scheme:** default `https` with `insecure_skip_verify` (recommended), or `http` to match how most users open the UI?
5. **Placement:** `/monitoring/prometheus` with the sidebar label "Prometheus" (recommended), or under System Settings next to Adaptive Polling?
