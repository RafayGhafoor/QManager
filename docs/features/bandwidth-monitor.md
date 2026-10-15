# Bandwidth Monitor (Retired)

The WebSocket live-traffic bandwidth monitor was **removed entirely on 2026-10-15 (v0.1.32 cycle)** with no replacement. QManager no longer shows live rx/tx throughput anywhere. This page exists so the removal, its reasons, and the upgrade-cleanup contract stay discoverable.

## Why It Was Removed

- The readings were inaccurate and not useful enough to keep.
- It exposed an unauthenticated, plaintext WebSocket (`websocat` on `0.0.0.0:8838`) on the LAN. The `qm_session` cookie never protected that port.

## What Was Removed

| Layer | Removed |
|---|---|
| Service | `/etc/init.d/qmanager_bandwidth` (procd: `websocat` + `bridge_traffic_monitor_rm551`) |
| Binaries / scripts | `/usr/bin/bridge_traffic_monitor_rm551`, `/usr/bin/qmanager_bandwidth_genconf` |
| CGI | `monitoring/bandwidth.sh` |
| UCI | `quecmanager.bridge_monitor.*` |
| Frontend | System Settings page `/system-settings/bandwidth-monitor` and its sidebar entry; hooks `use-bandwidth-monitor.ts` and `use-bandwidth-settings.ts`; `types/bandwidth-monitor.ts`; `formatBitsPerSec`; the dashboard Device Metrics "Live Traffic" row |
| i18n | `system-settings.bandwidth_monitor.*`, `sidebar.bandwidth_monitor`, `dashboard.metrics.live_traffic*` in all 5 locales |
| Installer lists | `websocat` dropped from `REQUIRED_PACKAGES`; `qmanager_bandwidth` dropped from `UCI_GATED_SERVICES` |
| Poller JSON | `at_cmd/fetch_data.sh` no longer emits a zeroed `traffic` object in its fallback JSON (matches [`API-REFERENCE.md`](../API-REFERENCE.md), which already documented no `traffic` object) |

## Upgrade-Cleanup Contract

`scripts/install.sh` defines `retire_bandwidth_monitor()`. `main()` calls it **unconditionally**, after `remove_conflicts` and before `stop_services`. It must keep doing the following, in order:

1. Stop and disable the service via `/etc/init.d/qmanager_bandwidth` first. **Why:** procd would otherwise respawn killed processes.
2. Remove the init.d script and the rc.d links.
3. Kill stray `websocat` / `bridge_traffic_monitor_rm551` processes.
4. `uci delete quecmanager.bridge_monitor` and commit.
5. Remove the generated `bridge_traffic_monitor.conf`, the `/tmp` runtime files, the binaries, and `/etc/qmanager/bandwidth_certs`.
6. `opkg remove websocat` if installed (nothing else depends on it).

It is idempotent and silent on fresh installs.

> ⚠️ WARNING: Do not move this into `install_packages`. Software Update runs `install.sh --skip-packages`, so anything inside the package step never executes on the upgrade path, and upgraded devices would keep port 8838 open.

`scripts/uninstall.sh` intentionally keeps its legacy kill/remove lines for devices that still carry the old service.

## Notes

- Do not reintroduce a LAN-facing unauthenticated socket for telemetry. If live throughput ever returns, serve it through an authenticated CGI path.
- Planning context: [`docs/rm520n-port-ledger.md`](../rm520n-port-ledger.md), Track W.
