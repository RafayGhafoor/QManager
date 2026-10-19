# Tailscale VPN (page anatomy)

Frontend reference for `/monitoring/tailscale`. The backend (install variants, `tailscale up` double-fork, the `--accept-routes` ban, the marker file, uninstall) lives in [`docs/features/tailscale-vpn.md`](../features/tailscale-vpn.md); read that before touching the CGI.

Tailscale is an optional, user-installed mesh VPN. Nothing in a stock install ships it, so the page's first job is to notice it is absent and offer to fetch it. Once installed it gives the modem a stable `100.x.y.z` address, which is the way back in when a change severs the LAN route (IP Passthrough, a gateway-IP edit).

> NEVER pass `--accept-routes` to `tailscale up`. It disconnects the device from the network and only a physical reboot recovers it.

---

## Quick Reference

| Item | Value |
| --- | --- |
| Route | `/monitoring/tailscale` (`app/monitoring/tailscale/page.tsx` renders `components/monitoring/tailscale/tailscale.tsx`) |
| Hook | `hooks/use-tailscale.ts` (poll 10 s, 3 s while an auth URL is pending) |
| CGI | `GET`/`POST` `/cgi-bin/quecmanager/vpn/tailscale.sh` |
| i18n | `common.json` `tailscale.*`, all five locales |
| Geometry | `components/monitoring/tailscale/shapes.ts`, the family's only shape module |
| Icons | lucide only (this route is on the lucide side of the icon boundary) |

---

## The GET is tiered, and the tiers are the contract

| Tier | Condition | Payload |
| --- | --- | --- |
| 1 | not installed | `installed: false`, `install_hint`, `other_vpn_installed` |
| 2 | installed, daemon down | `daemon_running: false`, `enabled_on_boot`, `version`, `install_variant` |
| 3 | daemon up, status unparseable | tier 2 plus `backend_state: "Unknown"`, `error_detail` |
| 4 | daemon up, status parsed | plus `backend_state`, `auth_url`, `self`, `tailnet`, `peers[]`, `health[]`, `exit_node_advertised` |

A shallow tier is the honest answer, not a failure. Every field after `installed` is optional, so `deriveView()` in `tailscale.tsx` tests them explicitly (`status.daemon_running ?? false`) instead of defaulting a tone in. A `??` that supplies a cheerful default invents a verdict the device never gave.

---

## `TailscaleView`: the six things the page may claim

`deriveView()` collapses the payload into one view that every child reads. No component re-derives state from a payload's shape.

| View | Reached when | Chip | Glyph |
| --- | --- | --- | --- |
| `notInstalled` | `installed` false | none (the header carries no chip) | none |
| `serviceStopped` | daemon down | `muted` | `PowerOffIcon` |
| `needsLogin` | `NeedsLogin` / `NeedsMachineAuth` | `warning` | `LogInIcon` |
| `running` | `Running` | `success` | `CheckCircle2Icon` |
| `disconnected` | any other backend state | `muted` | `MinusCircleIcon` |
| `unknown` | no status at all | `muted` | `CircleHelpIcon` |

Three views land on `muted`, which is why each carries its own glyph. `STATUS_VARIANT` is `satisfies Record<TailscaleView, BadgeVariant>`, so a view with no matching role fails the build.

## Four page shapes

- **Other VPN installed** (`other_vpn_installed`): the header and one `Banner` (`degraded`) naming the other VPN with a link to its page. No band, no cards; only one VPN can exist at a time.
- **`notInstalled`**: the install hero alone. No band, no peers card, no danger row.
- **No status at all** (`!status && !isLoading`): a destructive `ConditionBlock` with Retry. The peers card is a separate read and mounts with its own condition.
- **Everything else**: header, four-tile status band, the Connection / This device pair, the full-width peers table.

A failed poll on top of good data is a non-blocking notice above the content, never a replacement for it.

---

## Components

| File | Role |
| --- | --- |
| `tailscale.tsx` | Page shell, `deriveView`, the four band tiles, the reboot dialog owner |
| `status-band.tsx` | Four pinned-height tiles, the verdict chip (`SwapLabel` morph) |
| `connection-card.tsx` | Rail of actions per view (see below), Start on boot, Advertise as exit node and Tailscale SSH rows (On / Off `SegmentedField`), health notice, auth `ConditionBlock` with the one ambient loop |
| `device-card.tsx` | Tailnet identity as pill rows; every value is mono (identifiers the device emitted) |
| `peers-card.tsx` | The peer table; the only hairline surface |
| `install-card.tsx` | The not-installed hero: build choice (`SegmentedField`, Official / Tiny), install and Check again, transcript, manual command |
| `install-log-viewer.tsx` | Install transcript: the last 50 lines `install_status` sends as `log` (B5.7) |
| `danger-card.tsx` | `UninstallButton` (confirm dialog, trailing end of the Connection rail), plus `RebootDialog` |
| `condition-block.tsx` | The family's state block; the block IS the state |

### Target-only behaviour

- **Install variants.** `runInstall(variant)` posts `{action:"install", variant}`. The chosen build's caption sits under the pill group. The installed variant shows as a `Tag` in the Connection header (identity, not status). The manual opkg command (`install_hint`, else the fixed `tailscale.install.manualCommand`) shows only while Tiny is selected.
- **Exit-node advertising** (`set_exit_node`). Locked, with a visible note, until the node is `Running`: `tailscale set` cannot reach a stopped or logged-out daemon.
- **Tailscale SSH** (`set_ssh`, B5.7). Same lock rule as exit node. Turning it on confirms first (`sshDialogTitle` / `sshDialogDescription`); off applies at once. The state is tailscaled's `RunSSH` pref read back as `ssh_enabled`; while connected, `null` hides the row instead of guessing. The source's `sshPending` ("applies on next connect") is not ported: this CGI refuses while disconnected instead of storing a flag.

### Mutations and toasts

Every hook mutation returns `TailscaleActionResult { ok, reason }`. `reason` is already resolved through `resolveErrorMessage` (empty when the backend gave none). Handlers fire one toast at the terminal moment: `toast.success(t(...))`, or `toast.error(result.reason || t(fallbackKey))`. They never read hook `error` state after an `await`.

Install is asynchronous: the POST starts a background job and `install_status` is polled every 2 s. The install card fires one toast with the deterministic id `tailscale-install` when a run it watched goes `running` to `complete` or `error`; a result that was already terminal on mount never toasts. A refused start (`other_vpn_installed`, `already_running`) lands as an error notice with no job to poll.

### The action rail

At most one destructive button shows per state, and each is a step further from the live link than the last:

| View | Rail |
| --- | --- |
| `serviceStopped` | Start service |
| `needsLogin` | Connect (hidden while an auth URL is pending), Stop service, **Uninstall** (trailing edge) |
| `running` | Disconnect only |
| `disconnected` | Connect, **Log out** |

Log out appears only after Disconnect, and Uninstall only once the node is logged out (`NeedsLogin`), so neither sits one click from a working tunnel.

### Uninstall and the reboot hand-off

A successful uninstall flips the view to `notInstalled`, which would unmount the Connection card and its dialog. `RebootDialog` is therefore owned by the page shell. "Reboot now" calls `rebootNow("tailscale")` from `@/lib/reboot` (fire-and-forget POST, then the `/reboot/` countdown); "Reboot later" just closes it.

---

## Geometry that is measured, not asserted

- `TABLE.ROW_HEIGHT` is 52px: the device cell is a 20px name over a 16px DNS name inside 16px of padding. Both line boxes are explicit so the pin is arithmetic.
- The band's tile floor is 248px: a tile's text column is its width minus 106px of disc, gap and padding, so a smaller floor leaves too little for a 15-character address.
- `TILE_VALUE` is 18px: the band carries word verdicts ("Richiede accesso" is 167px at 22px).
- The peers skeleton has zero row gap plus each row's hairline, because a gapped stack is taller than the table it stands in for.

### Motion

One page cascade (`staggerContainer` / `staggerItem`), row cascades in the identity card and the peer table, a `SwapLabel` chip morph, and tonal tile fills crossing on `standard`. Exactly one ambient loop exists: the live dot during the auth wait. Nothing loops once connected.

---

## Gotchas

- The `--accept-routes` health advisory is filtered out of the health notice. It is normal on this device and not a fault.
- "Last seen" needs a 1970 guard. The device has no battery RTC, so `formatLastSeen` returns the unknown sentinel when `Date.now()` is before 2020 or the delta exceeds a year. Any new relative-time rendering on this platform needs the same guard.
- `peers[]` ordering is whatever the CGI's jq produces; the table does not sort and has no search.
- The `Banner` for the other-VPN case uses the `degraded` role (a warning-container notice), not `override`: the page genuinely cannot work until the other VPN is removed.
