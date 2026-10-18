# Bandwidth Monitor

The Bandwidth Monitor is an opt-in feature that streams live per-interface rx/tx speeds to the dashboard via WebSocket. It is **off by default** — when disabled, the dashboard Live Traffic row shows "Off · Turn on" with a link to System Settings → Bandwidth Monitor. There is no poller fallback; the dashboard either has live data from this feature or it surfaces an explicit state.

## Quick Reference

| Item | Value |
|------|-------|
| CGI | `GET/POST /cgi-bin/quecmanager/monitoring/bandwidth.sh` |
| UCI enable flag | `quecmanager.bridge_monitor.enabled` (default `0`) |
| WebSocket port | `8838` (UCI `quecmanager.bridge_monitor.ws_port`) |
| Binaries | `/usr/bin/bridge_traffic_monitor_rm551`, `/usr/bin/websocat` |
| Config file (generated) | `/etc/quecmanager/settings/bridge_traffic_monitor.conf` |
| Runtime file | `/tmp/quecmanager/bridge_traffic_monitor` |
| Init.d service | `qmanager_bandwidth` (procd, START=99) |
| Frontend hook (dashboard) | `hooks/use-bandwidth-monitor.ts` |
| Frontend hook (settings page) | `hooks/use-bandwidth-settings.ts` |
| Types | `types/bandwidth-monitor.ts` |
| Settings page | `/system-settings/bandwidth-monitor` |

---

## Data Flow

```
bridge_traffic_monitor_rm551  →  writes JSON to stdout
        ↓
websocat (ws-listen:0.0.0.0:8838, broadcast:mirror:)
        ↓
ws://<device-ip>:8838
        ↓
use-bandwidth-monitor (hook)  →  filters interfaces, aggregates bps
        ↓
LiveTrafficRow (device-metrics.tsx)  →  5-state UI
```

`bridge_traffic_monitor_rm551` is a compiled aarch64 ELF binary (not a shell script). It reads interface stats at the configured `refresh_rate_ms` (default 1000 ms) and emits JSON messages to stdout. `websocat` bridges stdout to all connected WebSocket clients using `broadcast:mirror:` mode — every client receives every message. The hook at `hooks/use-bandwidth-monitor.ts` connects, parses messages, and pushes a rolling 15-second chart buffer to the dashboard.

**Message filtering:** The hook excludes `rmnet_ipa0`, `rmnet_data2`, and `tailscale0` from the aggregate speed calculation. These interfaces produce noise (IPA offload path, secondary rmnet slots, tunnel overhead) that does not reflect real user traffic. They are still present in `BandwidthMessage.interfaces` if you need raw per-interface breakdowns.

**Aggregate selection — count every byte once.** The binary reports *every*
interface it discovers, and on real hardware the same bytes appear on more than
one of them, so `selectAggregateInterfaces()` (exported from the hook, and
unit-tested in `hooks/__tests__/use-bandwidth-monitor.test.ts`) narrows the
aggregate before summing:

| | rule | why |
|---|---|---|
| alias pairs | a parent netdev is dropped when its `.N` sub-interface is also reported (`rmnet_mhi0` goes, `rmnet_mhi0.1` stays) | on MHI modems both counters advance for the same bearer bytes (measured: totals within 0.6%) |
| bearer scope | when any `rmnet_*` / `wwan<N>` interface is present, the aggregate is **the bearer only** | a bridge (`br-lan`) and its member port (`eth0`) also carry forwarded traffic; adding them to the WAN doubles it |
| fallback | no bearer reported (WAN is an ethernet port) → sum everything not excluded | previous behaviour, unchanged |
| multiple bearers | still summed (`rmnet_data0` + `rmnet_data1` multi-PDN) | they are separate traffic |

Summing the raw array made the Live Traffic row read **2.00x** the wire rate on
both axes (a 265.7 Mbps Ookla download read 538-550 Mbps). After the change the
row matches `rmnet_mhi0.1` exactly, i.e. **1.00x**. The `interfaces` array handed
to callers is never modified — per-interface displays still see every interface,
including the aliases.

**Message format** (from `types/bandwidth-monitor.ts`):

```json
{
  "type": "update",
  "channel": "network-monitor",
  "data": { "timestamp": "...", "upload": 0, "download": 0 },
  "interfaces": [
    { "name": "rmnet_data0", "state": "up", "tx": { "bps": 125000 }, "rx": { "bps": 1562500 } }
  ]
}
```

The hook filters on `channel === "network-monitor"` and ignores messages on any other channel.

---

## Configuration

### UCI Keys

| Key | Default | Description |
|-----|---------|-------------|
| `quecmanager.bridge_monitor.enabled` | `0` | Master on/off switch |
| `quecmanager.bridge_monitor.ws_port` | `8838` | WebSocket listen port |
| `quecmanager.bridge_monitor.refresh_rate_ms` | `1000` | Binary poll interval in ms |
| `quecmanager.bridge_monitor.interfaces` | `br-lan,eth0,rmnet_data0,rmnet_data1,rmnet_ipa0` | Interfaces for the binary to monitor |
| `quecmanager.bridge_monitor.json_mode` | `yes` | Binary output format |
| `quecmanager.bridge_monitor.channel` | `network-monitor` | WebSocket channel tag |

The `json_mode` and `channel` keys are written to the generated config but are not exposed in the settings UI. They must be manually adjusted if needed.

### Generated Config File

`qmanager_bandwidth_genconf` (`scripts/usr/bin/qmanager_bandwidth_genconf`) translates UCI values into `/etc/quecmanager/settings/bridge_traffic_monitor.conf`. This file is read by the binary at startup. The init.d `start_service()` calls `genconf` before launching the binary, so UCI is the authoritative source — edit UCI, not the conf file directly.

---

## Init.d Service

`/etc/init.d/qmanager_bandwidth` is a procd service with two instances:

| Instance | Command | Purpose |
|----------|---------|---------|
| `websocat` | `/usr/bin/websocat -E -t --ping-interval 10 --ping-timeout 30 ws-listen:0.0.0.0:8838 broadcast:mirror:` | WebSocket broadcast server |
| `bridge_monitor` | `/usr/bin/bridge_traffic_monitor_rm551` | Interface stats binary |

Both instances are configured with `respawn 3600 5 5` (5 restarts max per hour, 5 s delay). The service short-circuits at startup if `quecmanager.bridge_monitor.enabled != 1` — the procd service is registered but exits immediately, so no processes start.

The `stop_service()` hook removes `/tmp/quecmanager/bridge_traffic_monitor` and `/tmp/quecmanager/bridge_traffic_monitor.pid`.

**Applying settings:** `bandwidth.sh` (CGI POST `save_settings`) calls `genconf`, then enables + restarts the service if `enabled=1`, or stops + disables it if `enabled=0`. The restart is backgrounded so the HTTP response returns promptly.

---

## Security Note

> ⚠️ WARNING: `websocat` binds on `0.0.0.0:8838` — all interfaces, unauthenticated, plaintext WebSocket. Any device on the LAN (or WAN, if the modem's firewall allows it) can connect and receive live traffic data without any session check. This is why the feature defaults to **off** and why it must not be changed to default-on without first either binding to a LAN-only address or adding an fw4 rule restricting access to port 8838.

The standard CGI auth cookie (`qm_session`) does not protect the WebSocket port. The frontend connects using `ws://` (not `wss://`), and the connection goes directly to the binary-to-websocat pipeline, bypassing `uhttpd` and `cgi_base.sh` entirely.

---

## Dashboard: 5-State Live Traffic Row

`LiveTrafficRow` in `components/dashboard/device-metrics.tsx` derives a single state discriminant from two hooks:

| State | Condition | UI shown |
|-------|-----------|----------|
| `loading` | `settingsLoading` is true | Skeleton |
| `disabled` | `settings.enabled` is false | "Off · Turn on" (link to settings), or "Unavailable" + tooltip if `websocat` is missing |
| `connecting` | Enabled, not connected, no error | Pulsing muted dot + "Connecting…" |
| `connected` | `isConnected` is true | Live rx/tx speeds with down/up icons |
| `unavailable` | Enabled, not connected, `wsError` set | "Unavailable" + warning triangle + reconnecting tooltip |

The `disabled` state has a sub-case: if `dependencies.websocat_installed === false`, the "Turn on" link is suppressed because toggling the switch without `websocat` installed won't help. A tooltip explains the missing dependency instead.

**Reconnection:** `use-bandwidth-monitor` reconnects automatically on close using exponential backoff (1 s base, 30 s ceiling). There is no manual retry button — the tooltip in the `unavailable` state tells the user the hook is retrying on its own.

**Aggregate exclusions:** `rmnet_ipa0`, `rmnet_data2`, and `tailscale0` are excluded from the displayed speeds to avoid inflated numbers from internal offload paths.

---

## Adding This Feature to a New Device

The `bridge_traffic_monitor_rm551` binary is aarch64-only. On other architectures it will silently fail to exec (procd respawn kicks in). The `websocat` dependency must be installed separately (`opkg install websocat` or equivalent). The settings UI surface-checks `websocat_installed` via `command -v websocat` in the CGI and blocks the "Turn on" link if it's absent.
