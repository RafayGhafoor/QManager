# Overview Splash

The **Overview** splash is the public, unauthenticated landing page served at `/`. Instead of dropping an anonymous visitor onto a login form, QManager greets them with a live status card: an Internet and Temperature pair, per-carrier signal, then carrier, network type and aggregate bandwidth, refreshed every 5 seconds before anyone signs in. A **Sign in to manage** button takes them to `/login/`, and a deliberate logout lands the user back here.

`/` renders a client-side gate that chooses between three outcomes: show the splash, confirm an existing session and forward to the dashboard, or (on a fresh device) bounce to `/setup/`. The splash reads two **public CGI endpoints** that expose a narrow, allowlisted slice of the poller cache. Nothing sensitive (IMEI, ICCID, IMSI, phone number, WAN/LAN IPs) is in the anonymous payload.

The card was re-authored on the RM520N canon in ledger row U3.4 (`67a5e3b8`), ported from `rm520n/development`. Target deviations are listed in [Target deviations](#target-deviations-from-the-rm520n-source).

---

## Quick Reference

| Item | Value |
|------|-------|
| Public route | `/` (`app/page.tsx`) |
| Login route | `/login/` (`app/login/page.tsx`) |
| Splash shell | `components/public/overview-card.tsx` (card, `resolveBodyMode`, footer) |
| Splash modules | `components/public/overview/{tone.ts,tiles.tsx,band-rows.tsx,states.tsx}` |
| Shared notice | `components/ui/tonal-banner.tsx` |
| Pre-auth type scale | `components/pre-auth-type.ts` (`CARD_TITLE`, eyebrow, body) |
| Quality map | `components/cellular/signal-quality-display.ts` |
| Supporting components | `components/public/mode-toggle.tsx`, `components/auth/login-device-name.tsx` |
| Hooks | `hooks/use-public-overview.ts` (5s poll), `hooks/use-device-hostname.ts`, `hooks/use-public-unit-preferences.ts` |
| Types | `types/public-overview.ts`, `types/device-hostname.ts`; `SignalQuality`, `METRIC_RANGES`, `normalizeMetricValue` in `types/modem-status.ts` |
| Helpers | `lib/public-overview/format.ts` (`deriveConnectionLabel`, `formatUptime`) |
| Public CGI endpoints | `scripts/www/cgi-bin/quecmanager/public/{overview,hostname}.sh` |
| Install path on device | `/www/cgi-bin/quecmanager/public/` (uhttpd) |
| Cache read by `overview.sh` | `/tmp/qmanager_status.json` (read-only; no AT, `qcmd` or `flock`) |
| Heartbeat written by `overview.sh` | `/tmp/qmanager_ui_active` (epoch; keeps the poller on the Active tier) |
| Indicator cookie | `qm_logged_in=1` (a hint, not proof of a session) |
| Session authority | `GET /cgi-bin/quecmanager/auth/check.sh` returns `{authenticated: bool}` |
| Icons | Material Symbols only (`/` and `/login/` are inside the Icon Boundary); no `<svg>` on `/` |
| i18n | `common` namespace, `overview.*` and `login.*`, bundled in all five locales |

---

## The `/` gate

`app/page.tsx` is a `"use client"` component that decides what `/` renders. It never renders a login form.

```
Gate = "public" | "checking" | "redirecting"
```

- **public**: render `<OverviewCard/>` inside a full-height stage. The card owns its own 544px cap (`max-w-[34rem]`), so the page adds no `max-w-*` wrapper.
- **checking**: an indicator cookie is present, so confirm the session first. Renders a blank background (no flash of the splash).
- **redirecting**: the session was confirmed; `window.location.href = "/dashboard/"`.

**Why the gate exists.** `qm_logged_in=1` is a plain, non-HttpOnly hint the frontend sets for fast routing. It can outlive the server session (a leftover from another origin, a bfcache page, deploy skew). If `/` trusted it, a logged-out visitor would be forwarded to `/dashboard/`, where the auto-logout poller kicks them to `/login/`, turning the landing page into a login trap. So the gate forwards only after `auth/check.sh` confirms the session, which validates the session file, not the cookie.

| `check.sh` result | Gate action |
|-------------------|-------------|
| `authenticated: true` | `redirecting` to `/dashboard/` |
| `authenticated: false` | `clearIndicatorCookie()`, then `public` (the cookie was stale) |
| non-2xx, network or parse error | `public`, cookie kept (may be a blip on a logged-in device; don't trap them, don't drop the hint) |

**Fast path.** With no indicator cookie the gate starts at `public` and makes no round-trip.

> ⚠️ WARNING: `check.sh` is hit on every load of the splash and returns additive rate-limit fields when signed out (`rate_limited`, `retry_after`, `attempts_remaining`). It must call only the read-only accessor `qm_get_rate_limit_status`, never the mutating `qm_check_rate_limit`, or refreshing `/` would extend the visitor's own lockout. See [`auth-rate-limiting.md`](auth-rate-limiting.md).

> ℹ️ NOTE: A fresh-install device (no password set) is handled one layer deeper. `overview.sh` answers `{state: "setup_required"}` and `OverviewCard` sets `window.location.href = "/setup/"`. The gate itself only distinguishes public, checking and redirecting.

---

## The OverviewCard

A single shadcn `Card`: header (logo, `CARD_TITLE` h1 "Modem Overview", `LoginDeviceName` in the description slot, `ModeToggle` in the action slot), body (live status), footer (Sign-in CTA, LuCI link, copyright and caption).

### File layout

| File | Holds |
|------|-------|
| `overview-card.tsx` | The shell, `resolveBodyMode`, `FAILURE_EMPTY_STATE_THRESHOLD`, the footer, the polite live region |
| `overview/tone.ts` | The tone vocabulary: `qualityValueClass()` / `qualityBarClass()` / `RAMP_BAR_CLASS`, `CONNECTION_TILE` / `TEMPERATURE_TILE` verdict maps, `temperatureBand` (`TEMP_WARN` 60, `TEMP_DANGER` 75 in Celsius), `BAND_METRIC_THRESHOLDS`, tile geometry, `formatAge`, `isNrBand` |
| `overview/tiles.tsx` | `TonalTile`, `StatusTile` |
| `overview/band-rows.tsx` | `BandRow`, `AggregateBandRow`, `SegmentedMetricToggle`, shared row geometry |
| `overview/states.tsx` | `ReadingChip`, `SkeletonBody`, `UnreachableState` |

Every map in `tone.ts` is keyed on a union type, never a raw class string, so a new state without a matching role fails the build instead of rendering untinted.

### `resolveBodyMode()`: one decision, two consumers

A pure function returns a `BodyMode`. The order is load-bearing (re-ordering it changes what a flapping modem shows):

```ts
type BodyMode =
  | "skeleton"           // 1. first paint, no data yet
  | "redirecting"        // 2. setup_required -> /setup/
  | "empty_fetch"        // 3 & 4. fetch error, with or without prior data
  | "empty_unavailable"  // 5. the poller itself reports unavailable
  | "bare_skeleton"      // 6. no usable payload, but no error either
  | "live";              // 7. the real thing
```

`empty_fetch` also triggers when `error` is set and `consecutiveFailures >= FAILURE_EMPTY_STATE_THRESHOLD` (3), promoting a still-rendering stale card to the empty state. **Why one function:** the footer caption must agree with the body about which state the card is in ("updated 4s ago", "retrying every 8s", "signing in still works"). Inlined, the two could drift; now both read `mode`, and the empty states show the "signing in still works" caption.

### Reading order: status, evidence, identity

A visitor asks "is it working" first, so the answer leads.

1. **Status pair**, Internet and Temperature.
   - **Internet** is one label reduced from the LTE and NR states by `deriveConnectionLabel` (priority: connected, searching, limited, inactive, error, disconnected, unknown). An unreachable modem reads **Offline** (`connection.modem_unreachable`).
   - **Temperature** is the SoC temperature in the visitor's unit. Four bands, four tones, four glyphs, none shared: `unknown` neutral `help`, `normal` success `thermostat`, `warn` (60 C and up) warning `warning`, `danger` (75 C and up) destructive `priority_high`. The tile body is neutral and the glyph disc carries the colour.
   - **`unknown` stays neutral.** A null temperature is no reading; painting it green is the same defect as an unmeasured antenna rendering green.
2. **Carriers**, one dense row per carrier component: band `Tag` (`nr` or `lte` variant by `isNrBand`), a 7px meter on the quality ramp, then the value. A small **RSRP / SINR** segmented toggle in the section header switches every row's metric and ramp tint. With no carrier components (attach in progress) the section falls back to one `AggregateBandRow` for the selected metric.
3. **Identity trio**, Carrier, Network, Bandwidth. Bandwidth is the aggregate MHz across components (for example "95 MHz"); the joined band list ("B1, N41") is that tile's `title` tooltip. The i18n key is still `overview.header.bands` so installed language packs keep their translation.

Band chips carry **identity** (which radio), while the meter and the value carry quality. The ramp has no identity hue, so an LTE-only visitor is never shown "healthy" in 5G blue.

> ⚠️ WARNING: Do not use `secondary-container` for the LTE role. The repo ships it as `--lte-*`; shadcn `--secondary` is a neutral.

**Metric normalization.** Band rows pass each carrier's value through `normalizeMetricValue()` (`types/modem-status.ts`, ranges in `METRIC_RANGES`, the 3GPP reported ranges). An out-of-range raw value, such as RSSNR 251 on an LTE carrier, becomes "no reading": the value renders "—" and the track is empty, never a fake excellent.

### The retired Overall tile

The old third status tile was the worst of RSRP, RSRQ and SINR. It was deleted, not restyled: the Carriers rows already answer "how is the signal" per carrier, with a toggle for the axis, and the tile shipped the same glyph on `excellent` and `good`, which the status vocabulary forbids (`success-container` and `warning-container` measure about 1.03:1 apart). **Accepted cost:** `signal.rsrq` is polled but rendered nowhere. If that trade looks wrong later, surface RSRQ in the rows; do not bring the tile back. The keys `overview.status.overall` and `overview.quality.*` stay (the latter feeds the rows' screen-reader ramp words).

### Quality map and the four-stop adaptation

`tone.ts` has no private quality-to-colour map. It wraps `components/cellular/signal-quality-display.ts` (`QUALITY_GLYPH`, `qualityBadgeVariant`, `qualityMeterTone`, `qualityInkClass`) and adds one axis, `reachable`:

| Export | Delegates to | Extra behaviour |
|--------|--------------|-----------------|
| `qualityValueClass(quality, reachable)` | `qualityInkClass()` | Unreachable returns `text-on-surface-variant`, never a ramp stop |
| `qualityBarClass(quality, reachable)` | `qualityMeterTone()` then `RAMP_BAR_CLASS` | Returns `null` (the empty-track signal) when unreachable or the tone is `null` |

An unreachable modem is **no reading**, not a bad one. `null` means draw no fill element, not a zero-length one; a 0%-wide bar beside "-140 dBm" reads as a fault to fix. `RAMP_BAR_CLASS` is keyed on `MetricBarTone`, so a new ramp stop cannot be added on one side only. The meter is a hand-built 7px `motion.div` rather than `MetricBar` because of its first-paint-only entrance.

> ⚠️ WARNING: **The target's `SignalQuality` has four stops** (the source has five: `bad` below `poor`, plus `floor` / `range` on `SignalThresholds`). Widening the shared union would touch eight authenticated files (the dashboard lte, nr, scc and signal-status cards, active-bands, the antenna-alignment meter and card, antenna-statistics), so `signal-quality-display.ts` omits the `bad` arms and maps `poor` to ramp stop 2; `quality-1` is unused. Progress bars match the source because the target's `poor` cut (-140 RSRP, -20 SINR) equals the source's `floor`. The key `overview.quality.bad` ships unused. When the five-stop model lands, restore the `bad` arms (`signal_cellular_0_bar`, `destructive`, `quality-1`, `text-quality-1`); the exhaustive switches will demand it. The antenna surfaces still keep private copies of these maps and adopt the module in their own ledger rows.

### The measured container cliff

The card is `@container/overview`. Both grids (status pair, identity trio) go multi-column at **`@[22rem]`** (352px of content box). The content box is about viewport minus 96px (16px page gutter plus 32px card padding, each side): 279px at 375 (stacks), 294px at 390. At 2-up on a 390px phone the status column leaves about 61px of eyebrow beside the disc, and English "Temperature" needs 88px, so the cliff sits at `22rem`, the first step where every eyebrow fits in every shipped locale. One label fits no 3-up at any width: Italian "Larghezza di banda" wants 136px against a 114px eyebrow at the 544px cap. It truncates on purpose, with the full text on the tile's `title`.

### Banners, empty states, loading

- **Stale** (cache older than 15s): `TonalBanner` `tone="warning"`, `icon="schedule"`, `size="compact"`, `role="status"`, copy `overview.stale.banner` with an `<age>` `Trans` component. The last-good numbers stay. The old chip key `overview.stale_indicator` is unreferenced but kept for installed packs.
- **Unreachable** (`modem_reachable: false` in an `ok` payload): `TonalBanner` `tone="destructive"`, `icon="signal_cellular_off"`, copy `overview.unreachable.banner`. Meters show empty tracks, values go neutral, the Internet tile reads "Offline".
- **Empty states** (`empty_fetch`, `empty_unavailable`) render `UnreachableState` in the **warning** container, not destructive: the status feed is gone, the login is not. `overview.empty.subtitle` names cause and recovery. The footer caption says "signing in still works".
- **Loading**: `SkeletonBody` mirrors the loaded geometry (shapes imported from the same constants) so data arrival causes no layout shift. The title, CTA and caption are real text and never skeletonised. While the first read is in flight a `ReadingChip` (`overview.loading_chip`) replaces the theme toggle at the same height; its spinner is the only loop on this surface.

**Accessibility.** One `sr-only` polite live region announces only verdict transitions (signal quality, connection state, temperature band), compared against the previous verdict, so the 5s poll does not re-announce on every tick.

**Motion.** Card entrance and the zone cascade use the canon tokens in `lib/motion.ts`. Meters grow by `scaleX` on **first paint only**: a `metersPainted` flag flips one frame after the first live render, so rows added mid-poll settle in and the 5s poll never replays the entrance. There is deliberately no shake anywhere on the pre-auth pair.

### Footer

A full-width Sign-in `Button` wrapping `<Link href="/login/">` (copy `overview.actions.login`, "Sign in to manage"), then the LuCI link (below), then the copyright line and the mode-dependent caption. Facts sit side by side with gap, not a middle-dot separator.

### `LoginDeviceName`

`components/auth/login-device-name.tsx` answers "which modem am I signing into". It owns its hostname fetch (`useDeviceHostname`) and three states (skeleton, resolved name, nothing). Its contract is **silent omission**: an older firmware without the CGI, or an unnamed device, resolves to `null` and no placeholder is invented. It has two variants: `signin` (default, mounted by `/`, the standalone "Sign in as <name>" line) and `title` (mounted by `/login/`, where the hostname is the card's h1). Login-card details are in [`auth-rate-limiting.md`](auth-rate-limiting.md).

---

## Target deviations from the RM520N source

| Area | Source | Target |
|------|--------|--------|
| Temperature units | Public `public/units.sh` (reads `/etc/qmanager/qmanager.conf` via `config.sh`) plus a temperature-only `usePublicUnitPreferences` | Ported in ledger B3.6, adapted: `units.sh` reads UCI `quecmanager.settings` and allowlists both values; the hook returns the same `{ tempUnit, distanceUnit }` shape as `useUnitPreferences` (below) |
| LuCI | Button removed (RM520N has no LuCI) | Kept as a ghost `Button size="sm"` pill under the CTA: "LuCI" plus Material `open_in_new`, `target="_blank"`, `href="/cgi-bin/luci"` (keys `overview.actions.luci`, `luci_aria`). It replaced the `react-icons` `SiOpenwrt` brand glyph so `/` stays Material-only. LuCI has its own login, so it stays reachable before sign-in |
| Quality model | Five-stop `SignalQuality` | Four-stop; see the warning above |
| Hostname | Kernel hostname only | UCI first, then `/proc` (below) |
| Backend | New `public/` endpoints | None changed in U3.4: `overview.sh` already projected the same fields. `units.sh` added in B3.6 |

---

## The public CGI endpoints

Both live in `scripts/www/cgi-bin/quecmanager/public/` and deploy to `/www/cgi-bin/quecmanager/public/`. Each sets `_SKIP_AUTH=1` **before** sourcing `cgi_base.sh`, and is read-only.

> ℹ️ NOTE: Auth is opt-out. `cgi_base.sh` runs `require_auth` on every request unless `_SKIP_AUTH=1` is set before it is sourced, so making an endpoint public is a deliberate one-line act. These two are the whole unauthenticated modem-status surface; treat any new field as a security change.

### `overview.sh`: the allowlisted projection

`GET /cgi-bin/quecmanager/public/overview.sh` is a **pure cache read** of `/tmp/qmanager_status.json` with a fixed jq allowlist. A field not in the template cannot appear, so IMEI, ICCID, IMSI, phone number, boot identifiers and WAN/LAN IPs are structurally excluded.

**UI heartbeat.** Before anything else it writes the epoch to `/tmp/qmanager_ui_active`, so any hit (including `setup_required` and `unavailable`) counts as UI activity and the poller stays on the Active cadence while a browser is on the splash. This is the one write the endpoint performs; see [`../features/adaptive-polling.md`](../features/adaptive-polling.md).

Live response (mirrored by `PublicOverviewOk` in `types/public-overview.ts`):

```json
{
  "state": "ok",
  "timestamp": 1721390000,
  "modem_reachable": true,
  "uptime_seconds": 84213,
  "network": {
    "type": "5G-NSA",
    "service_status": "registered",
    "carrier": "Example Mobile",
    "bands": [
      { "band": "B1", "bandwidth_mhz": 20, "pci": 431, "rsrp": -92, "rsrq": -11, "sinr": 14 },
      { "band": "N41", "bandwidth_mhz": 75, "pci": 512, "rsrp": -88, "rsrq": -10, "sinr": 18 }
    ],
    "lte_state": "connected",
    "nr_state": "connected"
  },
  "signal": { "rsrp": -92, "rsrq": -11, "sinr": 14 },
  "temperature": 48
}
```

| Field | Source in cache | Notes |
|-------|-----------------|-------|
| `timestamp` | `.timestamp` | Cache write time; the hook flags data older than 15s as stale |
| `modem_reachable` | `.modem_reachable` | Drives the unreachable banner and "Offline" |
| `uptime_seconds` | `.device.uptime_seconds // 0` | In the contract; the card does not render it |
| `network.bands[]` | `.network.carrier_components[]` | Only components with a non-empty `band`; each carries `bandwidth_mhz`, `pci`, `rsrp`, `rsrq`, `sinr` |
| `signal.{rsrp,rsrq,sinr}` | `.lte.*`, else `.nr.*` | LTE preferred, NR fallback, else `null` |
| `temperature` | `.device.temperature // null` | SoC temperature in Celsius |

| Condition | Response |
|-----------|----------|
| No password set (`is_setup_required`) | `{ "state": "setup_required" }` |
| Cache file missing or empty | `{ "state": "unavailable", "reason": "poller_not_started" }` |
| jq failure on the cache | `{ "state": "unavailable", "reason": "parse_error" }` |

> ℹ️ NOTE: Public overview `network.bands` can briefly drop to `[]` for a single poll. The card renders the aggregate fallback row; do not assume a single carrier.

### `hostname.sh`: device identity

`GET /cgi-bin/quecmanager/public/hostname.sh` returns `{ "hostname": "<string>" }`. Source order: UCI `system.@system[0].hostname` (canonical on OpenWrt), then `/proc/sys/kernel/hostname`, then an empty string. It strips CR/LF and clamps to 63 characters (RFC 1123). It always answers HTTP 200; an empty string is the "no name set" signal behind `LoginDeviceName`'s silent omission.

### `units.sh`: display units

`GET /cgi-bin/quecmanager/public/units.sh` returns `{ "settings": { "temp_unit": "celsius"|"fahrenheit", "distance_unit": "km"|"miles" } }`, the same keys and defaults as the authenticated `system/settings.sh` GET. Each value is allowlisted, so a hand-edited UCI value reads as the default and never reaches an unauthenticated caller; the endpoint exposes these two fields and nothing else from `quecmanager.settings` (which also holds the scheduled-reboot settings). It makes **zero writes**: unlike `system/settings.sh` it never seeds a missing section, which simply reads as celsius/km. Any method other than GET (OPTIONS aside) gets the `method_not_allowed` envelope. `usePublicUnitPreferences` (`hooks/use-public-unit-preferences.ts`) fetches it once on mount with `credentials: "omit"`, coerces each value again, and resolves to `null` on any failure, so the card falls back to celsius. No lifecycle edits: `install.sh` recopies and `uninstall.sh` removes the whole CGI tree.

---

## Why the hooks use plain `fetch` with `credentials: "omit"`

`use-public-overview` and `use-device-hostname` use a plain `fetch` with `credentials: "omit"`, not `authFetch`. `authFetch` hard-redirects to `/login/` on any 401, and a signed-out visitor is unauthenticated by definition, so the first fetch would bounce them off the public page. `credentials: "omit"` also keeps the pre-auth page from sending a session cookie it does not need.

`use-public-unit-preferences` follows the same rule. The splash no longer uses the authenticated `useUnitPreferences` (`hooks/use-system-settings.ts`), which stays on the dashboard with default same-origin credentials and a plain `fetch`.

> ⚠️ WARNING: Never swap `useUnitPreferences` to `authFetch` either: it once ran on `/`, and any display-preference read that can reach a signed-out page must not drive the 401 redirect to `/login/`.

`use-public-overview` adds:

- **5s poll** (`POLL_INTERVAL`), and **exponential backoff** once `consecutiveFailures` reaches `BACKOFF_THRESHOLD` (6), capped at 60s.
- **Stale detection** at 15s of cache age (`STALE_THRESHOLD_SECONDS`) without blanking the last-good numbers.
- **Empty state** after 3 consecutive failures (`FAILURE_EMPTY_STATE_THRESHOLD`).
- **Tab-visibility pause** and **AbortController** cancellation so a slow response cannot overwrite newer state.

`use-device-hostname` is single-shot and resolves to `null` on any failure.

---

## Logout wiring

`logout()` in `hooks/use-auth.ts` redirects to `/` (the splash), so a deliberate exit greets the user with the public overview. Flows that need a login form stay on `/login/`:

| Flow | Target | Why |
|------|--------|-----|
| Deliberate `logout()` | `/` | The user chose to leave |
| `changePassword()` success | `/login/` | The user must re-authenticate on a form |
| Session expiry, auto-logout (`use-auto-logout.ts`), auth guards | `/login/` | Involuntary; the user needs a form |
| `components/reboot/reboot-countdown.tsx`, post-reboot redirect | `/login/` | Returning after a reboot |
| `reboot-countdown.tsx`, direct-access guard (no session flag) | `/` | Unchanged by U3.4; lands on the splash |

> ⚠️ WARNING: Keep the split: voluntary exit goes to `/`, involuntary or credential-change exit goes to `/login/`.

---

## Related docs

- Login lockout ladder, `check.sh` rate-limit fields, `useLogin().lockout`: [`auth-rate-limiting.md`](auth-rate-limiting.md)
- Icon boundary, `TonalBanner` versus `Banner`: [`icon-system.md`](icon-system.md)
- Colour roles and the quality ramp: [`color-system.md`](color-system.md)
- Poller cache and the Active-tier heartbeat: [`../features/adaptive-polling.md`](../features/adaptive-polling.md), [`../BACKEND.md`](../BACKEND.md)
- Port ledger rows U3.3, U3.4 and B3.6: [`../rm520n-port-ledger.md`](../rm520n-port-ledger.md)
