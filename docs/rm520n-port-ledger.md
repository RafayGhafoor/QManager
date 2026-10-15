# RM520N → QManager Port Ledger

The single source of truth for bringing the RM520N fork's new UI/UX canon and its portable backend patches back into QManager (RM551E / OpenWRT). Every port run reads this file first and updates it on close. Items move through the statuses below. Nothing here bypasses the 6-phase Change Workflow in `CLAUDE.md`: each item is its own run, with its own tier, approval gate, worktree and `validator` pass.

| | |
|---|---|
| **Source** | `QManager-RM520N`, branch `development` (remote `rm520n` in this repo) |
| **Target** | `QManager`, branch `development-home` |
| **Common ancestor** | `63523d53` (v0.1.13). Source is 1,326 commits past it; target is 777. |
| **Sync cursor** | Source reviewed up to **`2ebfada1`** (2026-10-15). On the next survey, start with `git log 2ebfada1..rm520n/development`. |
| **Opened** | 2026-10-15 |

**Status legend:** `TODO` · `DECIDE` (needs a user call first) · `RECON` · `PLANNED` · `IN PROGRESS` · `VALIDATING` · `DONE` · `SKIP` (with a reason) · `BLOCKED`

---

## Ground rules for every port

1. **Port intent, not diffs.** Source runs on systemd, lighttpd, iptables and Entware. Target runs on procd, uhttpd, fw4/nftables and UCI. Rewrite every backend change for the target platform. Never copy a `.service`, `.timer`, `#!/bin/bash` script or iptables rule over as-is.
2. **Porting goes both ways.** Some features exist only in the target and must survive every UI re-author: Netbird, Config Backup/Restore, Adaptive Polling, DPI Masking / Video Optimizer, the Connection Scenarios route, and the deferred-reboot banner. If a source page has no equivalent for one of these, design the slot for it. Don't drop it.
3. **Recon both trees.** Phase 1 recon for an item reads the source implementation *and* the target's current code and live device state. Source commit hashes are listed per item so the brief can point straight at them.
4. **Keep the lifecycle scripts in lockstep.** Any backend port updates `install.sh`, the update path and `uninstall.sh` together: file copy, UCI seed, daemon start, and `/tmp` plus reload-flag cleanup.
5. **Close every item in this file:** set its status, add the target commit hash(es), and write anything learned into the Decisions Log or Findings.

---

## Track W — Retire the WebSocket live-traffic monitor (do first)

**Why:** the user's call on 2026-10-15. The websocat/bridge monitor is inaccurate and adds little value. It also leaves an unauthenticated port open on :8838 and a tracked binary in the repo. Retiring it first also takes the Live Traffic row out of the dashboard before Track U re-authors that dashboard.

**Tier 4** (installer, init.d, UCI). Hard Phase 1 `modem-investigator` gate, and on-device `validator` checks.

| ID | Item | Status | Notes |
|---|---|---|---|
| W1 | Live recon: is the monitor enabled on the test modem? Check for a running websocat or bridge process, the UCI `quecmanager.bridge_monitor` section, the rc.d symlink, `/etc/quecmanager/settings/bridge_traffic_monitor.conf`, and any hand-made 8838 firewall rule | DONE | Read-only |
| W2 | Backend removal: `scripts/etc/init.d/qmanager_bandwidth`, `scripts/usr/bin/qmanager_bandwidth_genconf`, `scripts/usr/bin/bridge_traffic_monitor_rm551` (plus its `.gitattributes:10` entry), and CGI `monitoring/bandwidth.sh` | DONE | |
| W3 | Upgrade cleanup in `install.sh`: stop the service before deletion; `uci delete quecmanager.bridge_monitor` and commit (same style as the WoL removal near `install.sh:1517`); remove the generated conf and `/tmp/quecmanager/bridge_traffic_monitor{,.pid}`; drop `websocat` from REQUIRED_PACKAGES (`:77`) and `qmanager_bandwidth` from UCI_GATED_SERVICES (`:85`); `opkg remove websocat` when only we installed it | DONE | The existing stale-init prune (`:1530`) and stale-binary prune (`:1519`) already catch the init script and the binary Correction: `opkg remove websocat` runs in an unconditional `retire_bandwidth_monitor()` step called from `main()`, not in `install_packages`, because Software Update runs `install.sh --skip-packages`. |
| W4 | `uninstall.sh`: keep the kill and removal lines for legacy devices; update the header comment | DONE | |
| W5 | `at_cmd/fetch_data.sh:56` still emits a zeroed `traffic` object. Remove it if no consumer reads it (`API-REFERENCE.md:104` already says there is none) | DONE | Check consumers first Done: the trailing comma left in the fallback JSON was removed too. |
| W6 | Frontend removal: `hooks/use-bandwidth-monitor.ts`, `hooks/use-bandwidth-settings.ts`, `types/bandwidth-monitor.ts`, `components/system-settings/bandwidth-monitor/`, `app/system-settings/bandwidth-monitor/`, the sidebar entry (`app-sidebar.tsx:78`), and `LiveTrafficRow` in `components/dashboard/device-metrics.tsx` | DONE | The row has no fallback, so the dashboard simply loses it. Re-balance the Device Metrics card |
| W7 | i18n: delete `system-settings.bandwidth_monitor.*`, `dashboard.metrics.live_traffic*` and `sidebar.bandwidth_monitor` in all 5 locales (en, zh-CN, zh-TW, it, id) | DONE | Run the parity checker afterwards |
| W8 | Docs: retire `docs/features/bandwidth-monitor.md`; update the CLAUDE.md and `docs/features/README.md` rows, API-REFERENCE, BACKEND, FRONTEND, the READMEs (en/id/default), the Stream Violet and Throughput-Direction rules in DESIGN.md, PRODUCT.md:56, and RELEASE_NOTE | DONE | Also update the memory note "Poller traffic fallback removed" |

---

## Track U — UI/UX canon port

The source rebuilt its whole design system. The big sweeps landed from 07-28 to 10-12. Source `DESIGN.md` is 1,061 lines against the target's 574, and source `globals.css` is 1,040 lines against 238. The work must go **bottom-up**: canon → tokens → primitives → shell → pages. Page re-authors before tokens and primitives would be wasted effort.

### U0 — Decisions (blocking; settle before U1)

| ID | Decision | Status | Default recommendation |
|---|---|---|---|
| U0.1 | Adopt the source canon wholesale (fonts, palette, role tokens, filled tonal chips, Card-Foot Apply, Material Symbols, new motion durations), or adopt it selectively? | DONE (wholesale) | **Wholesale.** Running two design languages across the forks costs more each time a page is ported. `CLAUDE.md`'s Design Context section and the target `DESIGN.md`/`PRODUCT.md` are rewritten from the source, with OpenWRT/RM551E platform wording |
| U0.2 | Conflicts with standing target preferences: **(a)** Connection Scenarios keeps its vivid gradients (source removed them in `eb099d2f`); **(b)** settings pages keep the uniform 2-col grid (check it against the source's Full-Width Page and Symmetric-Pair rules); **(c)** quiet identity as plain muted text (check it against the source's Identity-Chip rule) | DONE (no exceptions) | User: "Just follow RM520N design". All three target preferences are dropped |
| U0.3 | Target-only surfaces that the source canon never covered: Netbird, Config Backup, Adaptive Polling, DPI Masking/Video Optimizer, Connection Scenarios. Re-author them in the new canon during U4 | DONE (yes) | One U4.11 row each when scheduled |

### U1 — Canon and tokens

| ID | Item | Status | Source refs | Notes |
|---|---|---|---|---|
| U1.1 | Port `DESIGN.md` + `PRODUCT.md` (with platform wording swapped), and rewrite CLAUDE.md "Design Context" | DONE (uncommitted) | `340d78e8`, canon commits 08-30 to 10-06 | Ported from source `a05c4e92`. DESIGN.md Migration Deltas is now a canon-vs-code table keyed to these rows; new `docs/reference/` color-system, icon-system, motion-preference, toast-confirmation, tailwind-prose-hazard; `ui-builder` agent brief re-pointed; `docs/DESIGN-SYSTEM.md` marked superseded |
| U1.2 | `app/globals.css` token system: role triads (`-container`, `on-*`), `surface-container-*`, the radius scale (`--radius-{card,field,hero,inline,pill,tile}`), `--shadow-whisper`, `--card-sheen`, `--quality-*`, `--tone-*`, `--tag-*`, direction tokens, motion duration/ease tokens, chart tokens | DONE | | Source `a05c4e92` lines 1–659 (variants, `@theme`, `card-sheen`, both themes, base layer) plus the canon `pulse-ring` on ambient tokens. `--font-sans` stays on Manrope until U1.3. Kept target-only `progress-indeterminate` and the view-transition reset. Dropped the unused `spark-draw` and `halo-breathe`. Deferred to their consumers: `.material-symbol` (U1.3), the reduced-motion tw-animate block (U2.2), `.nav-indicator` (U3.1), `banner-in` (landed with U2.1a), and `live-ping`, `ca-*` and `chart-draw` (U2.3/U4). The legacy `--radius` chain stays live |
| U1.3 | Fonts: Rethink Sans (variable), vendored JetBrains Mono, Material Symbols Rounded subset (`app/fonts/`, `app/layout.tsx`) | DONE | | All three faces through `next/font/local`; `--font-sans` now points at Rethink Sans. Also ported the source's `material-symbol-names.ts` (117 glyphs, as-is), `scripts-dev/subset-icons.ts` + `check-icons.ts`, the `icons:subset` / `icons:check` scripts (`package` now runs `icons:check` first) and the `.material-symbol` CSS block. The `MaterialSymbol` component landed with U2.1a. Static export verified: the four woff2 files ship under `out/_next/static/media`, nothing in `out/` references Google, and the login page loads Rethink Sans with zero off-origin requests. The motion boot script and providers in the source layout belong to U2.2; the target keeps `MotionConfig` until then |

### U2 — Primitives and shared lib

| ID | Item | Status | Notes |
|---|---|---|---|
| U2.1a | `components/ui/` primitives with no motion dependency: new `material-symbol.tsx`, `tag.tsx`, `card-foot.tsx`, `banner.tsx` (8 roles, lucide glyphs, route-agnostic), `tonal-banner.tsx` (Material glyph); restyle `badge`, `button`, `card`, `dialog`, `input`, `select`, `textarea`; rebuild `hint-icon` on `Popover` | DONE | Ported from source `rm520n/development`, additive APIs. `badge.tsx`: filled tonal `success` / `warning` / `destructive` / `info` plus `muted`, exports `BadgeVariant`. `button.tsx`: `rounded-pill`, `tonal` / `tonal-neutral` / `tonal-destructive`, `action` size, 44px coarse-pointer hit areas; the target-only `icon-touch` size is kept (`components/auth/login-language-picker.tsx`). `card.tsx` adds `card-sheen`; `dialog.tsx` follows the Modal-Exit Rule; `input` / `select` / `textarea` sit on `fieldVariants` (42px, `host` prop). `hint-icon.tsx`: hover preview plus click pin, Material glyph, `variant` becomes `tone` (`info` / `warning`), `size` and `muted` dropped; all 8 call sites in 5 files migrated (the 2 former `muted` uses now render `info`). `globals.css` gains `banner-in` and the canon `motion-reduce` block (the `banner-in` deferral from U1.2). Banner conversion of existing banners (deferred-reboot, `sim-swap-banner.tsx`, `reconnecting-banner.tsx`) and the outline-badge call sites are NOT in this row: U3 / U4 and U2.4. Map the deferred-reboot banner onto Banner role 08; it is dismissible today, but the canon's Dismiss-Only-Notices Rule says a standing condition has no dismiss. Visible app-wide: every Button is a pill, fields are 42px filled, cards and dialogs carry `card-sheen` in dark mode. Verified: tsc, eslint, `icons:check`, static build, light and dark preview |
| U2.1b | `components/ui/`: `segmented-field.tsx`, `tick-group.tsx`, `ticking-value.tsx` (+ `hooks/use-value-tick.ts`), `swap-label.tsx`, `metric-bar.tsx`; rework `save-button.tsx` | TODO (unblocked by U2.2) | Split from U2.1 on 2026-10-15: these import the source motion system (`DUR.quick`, `EASE_QUICK`, `TICK`, `TICK_STAGGER_STEP`, `STAGGER_STEP`, `transitionStandard`, `transitionMeterFill`, `SAVE_CHECK_KEYFRAMES`, `transitionSaveCheck`, `lib/motion-preference`), which U2.2 ports. `save-button.tsx` drops `savingLabel` / `savedLabel` (11 uses in 6 files: watchdog-settings-card, masquerade-panel, alerts-settings-card, cdn-hostlist-card, video-optimizer-panel, lan-config-card), adds `blockedReason`, and defaults the label to `t("actions.save_settings")`, a key to add to all five catalogs (en, zh-CN, zh-TW, it, id) |
| U2.2 | Motion: source `lib/motion.ts` (quick 360 / standard 600 / emphasized 800), `lib/motion-preference.ts`, `components/motion-provider.tsx` + `motion-preference.tsx` (pre-paint attribute, `b4bf6042`); delete `lib/motion-presets.ts` | DONE | Replaces the target's "Motion reference system" memory. `lib/motion.ts` replaced verbatim from `rm520n/development` with no compatibility aliases; `lib/motion-presets.ts` deleted; `lib/motion-preference.ts`, `components/motion-preference.tsx` and `components/motion-provider.tsx` added verbatim. `app/layout.tsx`: the render-blocking boot script is first in `<body>`, then ThemeProvider > MotionPreferenceProvider > MotionProvider > I18nProvider; the old root `MotionConfig reducedMotion="user"` is gone. `globals.css` gains the reduced-motion tw-animate block (the U1.2 deferral). `eslint.config.mjs` bans `useReducedMotion` (motion/react, framer-motion) and `matchMedia(... prefers-reduced-motion ...)`, exempting the two resolver files. Migration of 24 old-export files: `EASE_OUT_EXPO` to `EASE_STANDARD`, `EASE_OUT_QUART` to `EASE_QUICK`, `DUR.fast` to `quick`, `base` / `slow` to `standard`, `slower` to `emphasized`, `transitionBase` to `transitionStandard`; in-card row cascades (system-settings, scheduled-ops, diagnostics, ipa-offload, update-status / update-preferences, known-sims-row, sms-inbox, device-status, connection-quality cards) to `staggerRows` / `staggerRowItem`, the dashboard card grid to `staggerContainer` / `staggerItem`; label swaps use `DUR.quick` + `EASE_QUICK`; `app-layout.tsx` route transition is the source's enter-only rise (no `AnimatePresence` exit). 14 `useReducedMotion` uses in 12 files and the `step-done.tsx` matchMedia moved to `useMotionReduced()`. `save-button.tsx` got only that swap plus the quick tokens; its rework stays in U2.1b. The sidebar user menu (`nav-user.tsx`) gained the Animations row (System, Full, Reduced cycle under Theme) with lucide glyphs (Settings / Sparkles / CircleMinus) because the sidebar stays lucide until U3.1 converts it to Material; keys `motion.label/system/full/reduced` added to all five catalogs, translations copied from the source. Verified: `bun run build`, `bunx tsc --noEmit` and `bun run icons:check` pass; `bunx eslint .` shows no motion-rule violations (a stdin probe confirmed both rules fire) and 5 pre-existing errors in untouched files (see Findings). Preview on `/login/`: the boot script is first in `<body>` so `data-motion` is set before paint; under `qmanager_motion="reduced"` the entrance fade does not run and under `full` it does; under `data-motion="reduced"` tw-animate `--tw-enter-translate-y` resolves to 0 and scale to 1 |
| U2.3 | Helper libs as pages need them: `carrier-aggregation.ts`, `carrier-match.ts`, `band-frequency.ts`, `event-presentation.ts`, `radio-info.ts`, `schedule-timeline.ts`, `ipv6.ts`, `clipboard.ts`; per-family `shapes.ts` files | TODO | Port them with their first consumer, not ahead of it |
| U2.4 | Badge flip: replace the outline+tint pattern with filled tonal chips in every target call site; update `ServiceStatusBadge` | TODO | Grep `bg-(success\|warning\|destructive\|info)/15`. Use the source's wrapper approach, not find-and-replace |
| U2.5 | Decide the fate of the target-only primitives `animated-beam`, `animated-list`, `animated-theme-toggler` and `radio-group` under the source's motion ceiling | TODO | |

### U3 — App shell and navigation

| ID | Item | Status | Notes |
|---|---|---|---|
| U3.1 | Sidebar: `nav-menu.tsx` + `nav-section.tsx`, replacing the five `nav-*.tsx`; source grouping (Dashboard / Cellular / Local Network / Monitoring / System; Connection Quality parents Latency Monitor and Network Events) | TODO | `b6c68551`, `959220b3`. Slot in the target-only routes (Netbird, Config Backup, Adaptive Polling, Connection Scenarios). Bandwidth Monitor is already gone via W6 |
| U3.2 | Route reconciliation: decide on the source-only routes `monitoring/connection-quality`, `monitoring/events`, `system-settings/system-health-check`, `system-settings/web-console` and `local-network/ethernet` | TODO | Static export means fixed routes only. Leave redirects for moved routes |
| U3.3 | Pre-auth/login surfaces (`pre-auth-type.ts`) | TODO | Strip RM520N copy |

### U4 — Page re-authors (each is its own run; order follows dependencies)

| ID | Surface | Status | Source refs | Backend dep |
|---|---|---|---|---|
| U4.1 | Card-Foot Apply sweep: Settings, cellular settings; retire the fading "Saved" labels in favour of toasts | TODO | `2e1df13b` `7b65d7e1` `17c75e92` `a2c0c782` `812f5b0e` | None |
| U4.2 | Canon re-authors: Tailscale, System Settings, Health Check, Logs, Languages, Software Update, About/Support, AT Terminal | TODO | `0b3598d3` `6cc5ff5c` `7a882f65` `002fee53` `1cc78156` `325182c8` `e578f4fd` `3f75e464` | Mostly none. Health Check may need a CGI |
| U4.3 | Cell Scanner + Neighbouring Cells (the101 layout) | TODO | `c20491f2` `62f5b816` `eecf1276` | None. Check the target's recent NR PRB/SCS fixes are kept |
| U4.4 | IP Passthrough strip-over-card | TODO | `ae2fb928` | B1.2 |
| U4.5 | Network Events: Right now + Activity bar chart, grouped repeats | TODO | `17c1cb3f` `1ae76280` `3c7fa3fa` | B2.3 |
| U4.6 | Watchdog bento with per-card saves | TODO | `91a78420` `cb0d701e` `baa10530` | B2.1 (`interval_sec`), B2.5 |
| U4.7 | Connection Quality: two compact cards, plus the dashboard CQ card replacing Live Latency | TODO | `cebb8185` `9d156cbe` `e029d43b` `313492ef` `932122bb` | B2.1, B2.2 |
| U4.8 | Latency Monitor + Sites card | TODO | `58765b56` `1109ca67` `cf2b5c14` `c9d162a2` `8e8806ec` | B3.1 |
| U4.9 | Alerts compact bento | TODO | `dd1cd602` `71fb714c` | B2.4. B3.2 if Discord ships |
| U4.10 | Dashboard composition (status rail, reboot heartbeat) | TODO | `status-rail.tsx` | After W6 + U4.7 |
| U4.11 | Target-only surfaces in the new canon: Netbird, Config Backup, Adaptive Polling, DPI Masking/Video Optimizer, Connection Scenarios, Custom SIM Profiles, Band Locking, APN, SMS, LAN Config, Custom DNS | TODO | none | None. One row each when scheduled |

**Don't port as-is:** source `traffic-engine/*` (the tpws/Full Bypass engine, which differs from the target's Video Optimizer), `band-grid-card.tsx`, `qmanager-band.tsx`, `modem-subsystem-card.tsx`, `signal-storm-labels.ts`, and any RM520N copy in `support.tsx` or `login-language-picker.tsx`.

---

## Track B — Backend patches

Statuses here are from a grep-level survey. Every row still needs its own Phase 1 recon before work starts.

### B1 — Bug fixes that apply directly (Tier 1, high value, do early)

| ID | Fix | Status | Source | Target evidence |
|---|---|---|---|---|
| B1.1 | Anchor the MPDN rule and time-advance parsers on the reply prefix so qcmd's echoed `AT+…` line can't match | DONE `a7618aa7` | `63468c3c` | `parse_at.sh:747`, `:761`, `:1070` |
| B1.2 | IP passthrough: read NAT/USB/DNS from the reply line only | DONE `a7618aa7` | `ae2fb928` | `parse_at.sh` ~`:1089`. Already comma-anchored here, but a set-form echo still matched and the value fell back to the default |
| B1.3 | `debug_poller_at.sh` calls `qcmd`, not the poller-only `qcmd_exec` | DONE `b6b22f2c` | `4e3acdab` | `scripts/debug_poller_at.sh:43`, `:74` |
| B1.4 | Daemon library-source guards: under BusyBox ash, `. lib 2>/dev/null \|\| {stubs}` aborts instead of running the stubs | DONE `5e4bab2c` | `6daf6dbd` | `qcmd:23` plus 10+ daemons in `scripts/usr/bin/` (matches the memory note "BusyBox dot-source aborts on missing file"). 28 sites incl. the poller (`#!/bin/sh` here). Bare `. lib 2>/dev/null` lines without `||`, and the lib/CGI `|| {}` sites, are left for a follow-up |
| B1.4a | Library and CGI source guards: the rest of the B1.4 sweep (libs, CGIs, bare `. lib 2>/dev/null` with no fallback) | DONE `55c211cb` | `6daf6dbd` | 25 files. Hard deps: a CGI returns an `internal_error` envelope, a daemon logs "<lib> missing; cannot run" and exits 1. Optional deps are skipped. The `cgi_base.sh` `require_auth` stub now fails closed (500). Bare sources with no `2>/dev/null` (e.g. `profiles/*.sh` and `profile_mgr.sh`, `config-backup/apply.sh`) still abort, which fails closed; they are left as is |
| B1.5 | SMS lock-timeout mislabelled as an AT failure | TODO | `2c468f3e` | `cellular/sms.sh` ~`:90` |
| B1.6 | jq `//` treating `false` as absent | TODO | `11b75e46` | Audit `network/dns.sh` and other `// default` reads of booleans |
| B1.7 | Watchdog/poller AT-failure fail-open sweep | TODO | `00966dcc` `b4d87efe` | Verify |
| B1.8 | CGCONTRDP parsing by comma and octet count; quoted gateway | TODO | `03722d91` `a88e23c9` `859c57ab` | Verify in `parse_at.sh` / `apn_mgr.sh` |
| B1.9 | Connectivity emit matches the ICMP ping daemon output | TODO | `000255ea` | Verify |
| B1.10 | Settle-debounce for band and PCI; blank readings stop clobbering the baseline | TODO | `c5fc6390` | Verify |
| B1.11 | Clock-step (1970) timer guard (issue #9) for scheduled reboot, scenario/tower schedule, auto-update and watchcat | TODO | `96cc4e1e` `25599f24` `14b07359` | Verify. The guard logic ports directly; `.timer` units become cron/procd |
| B1.12 | Cell/neighbour scanner singleton made real, and errors no longer swallowed | TODO | `fcec1b0f` `a2394ee9` | The target has a PID singleton; diff it first |

### B2 — Connection Quality unification (Tier 3; feeds U4.5–U4.9)

| ID | Item | Status | Source | Notes |
|---|---|---|---|---|
| B2.1 | Shared ping-cache reader `usr/lib/qmanager/conn_state.sh`, used by the poller and watchcat; one cadence resolver | TODO | `e61cfeb4` `3fb535ba` | The target ping profile lives in UCI (`quecmanager.ping_profile.*`). Reconcile it with the source's `interval_sec` model before porting the watchdog POST |
| B2.2 | DNS lookup time in `qmanager_ping` + poller | TODO | `aec8a1ad` | Confirm the BusyBox resolver/timing tools on the RM551E |
| B2.3 | One detector, one alert; `ca_change` debounced via a sticky `_ev_settle` | TODO | `30426c55` `5c6a2700` `f0e7aec3` | The target `events.sh` has its own detector (~`:194–253`) and emits `ca_change` immediately |
| B2.4 | Alerts backend fixes: real trigger in the log, retry on connect, translated errors | TODO | `dd1cd602` `0ceb32f6` | Read `docs/features/alerts.md` first |
| B2.5 | Revert an unconfirmed Tier 3 swap in watchcat | TODO | `ba4df3b3` | Check against the target's SSR-aware hold and SIM-failover lifecycle |

### B3 — New features (Tier 3–4; each needs a go/no-go)

| ID | Feature | Status | Source | Port notes |
|---|---|---|---|---|
| B3.1 | Per-site latency "Sites" monitor with a live "Now" lease probe | DECIDE | `3af1cc15` `c9d162a2` `8e8806ec` `33047f70` | Rewrite `qmanager_sites` for ash (the source uses `#!/bin/bash`); systemd unit → procd init.d; CGI `monitoring/sites.sh`; untrusted-pid fix from `ba4df3b3` |
| B3.2 | Discord alerts channel + Go bot | DECIDE | `b45a3aab` `0ceb32f6` `ce155354` `74e96458` | The bot is Go built for armv7; the RM551E needs an aarch64 build. Systemd → procd. Bring in the spool/symlink hardening along with it |
| B3.3 | DPI tpws bypass engine / Full Bypass rename | SKIP (for now) | `3cb6b93c` … `44360f34` | iptables-based, and the target engine (nfqws + nft) has diverged. Revisit as its own project |

### B4 — Hardening audits suggested by source fixes

| ID | Audit | Status | Notes |
|---|---|---|---|
| B4.1 | `/tmp` planted-path and symlink-write sweep for root writers (the class behind `ce155354` and `74e96458`) | TODO | Read-only recon first |

---

## Skipped wholesale (RM520N-only)

Entware bootstrap and `S80lighttpd`/opkg handling, SDX55/RG501Q platform detection (`hw_profile.sh`), the speedtest fast.com path, test-harness/RED-test commits, and the `.claude/` orchestra tooling. The source's `.claude/HANDOFF-design-migration-followups.md` is history, not backlog: tasks A, B and C1 are done there.

---

## Suggested run order

1. **Track W** (W1–W8). One Tier 4 run.
2. **B1.1–B1.4.** Small Tier 1 fixes with confirmed target evidence.
3. **U0 decisions**, then **U1 → U2.1a → U2.2 → U2.1b → U2.3+ → U3**, one run each (U2.1b waits on the U2.2 motion system).
4. **B2**, then the U4 pages that depend on it (U4.5–U4.7, U4.9). In parallel, the backend-free pages (U4.1–U4.4).
5. **B3 go/no-go**, then U4.8 if Sites ships.
6. U4.10 dashboard, then the U4.11 target-only surfaces.
7. Re-survey the source past the sync cursor and append new rows.

---

## Decisions Log

| Date | Decision | By |
|---|---|---|
| 2026-10-15 | U0: adopt the RM520N canon wholesale with no target exceptions (Scenario gradients, the 1-card 2-col grid and plain-text identity all give way to the source rules); target-only surfaces get their own U4.11 rows | User |
| 2026-10-15 | B1.4a: the cgi_auth.sh fallback `require_auth` fails closed instead of keeping the no-op stub, so a missing auth lib can't become a bypass | Opus |
| 2026-10-15 | B1.1 and B1.2 shipped as one commit (both edit the same parse_at.sh parsers) | Opus |
| 2026-10-15 | Retire the WS live-traffic monitor (websocat :8838 + `bridge_traffic_monitor_rm551`); the dashboard Live Traffic row goes with it, with no replacement | User |
| 2026-10-15 | websocat opkg package removed on upgrade (nothing else depends on it) | User (approved plan) |
| 2026-10-15 | Ledger opened; source sync cursor `2ebfada1` | Opus |
| 2026-10-15 | U2.2: include the sidebar Animations (System / Full / Reduced) row now, with lucide glyphs until U3.1; in-card cascades map to `staggerRows` / `staggerRowItem`, card grids to `staggerContainer` / `staggerItem`; the route transition is enter-only | User (approved plan) |
| 2026-10-15 | Split U2.1 into U2.1a / U2.1b around the U2.2 motion dependency (the target `DUR` scale is incompatible with the source primitives); keep the target-only `icon-touch` Button size; `HintIcon` `muted` folds into `info` | User (approved plan) |

## Findings

- The repos are siblings, not a superset and subset. Expect two-way gaps on every surface.
- The survey was grep-level. The "Verify" rows in B1 are leads, not confirmed bugs.
- U1.1 port (2026-10-15) left these for later rows. The Sequenced Pipeline Dialog's determinate bar conflicts with the canon's Loader-and-Dots Rule (decide in U4.11). The canon names `public/qmanager-mark.svg`, but the target only has `qmanager-logo.svg` (U3). `README*.md` still says "Euclid Circular B + Manrope". Several `docs/features/*.md` describe the old 2-col and status-first layouts; they change when their U4 rows land.
- U2.2 (2026-10-15) found 5 `bunx eslint .` errors that already existed in files it did not touch: `components/dashboard/live-latency.tsx`, `components/monitoring/latency-monitoring/latency-monitoring-card.tsx`, `lib/reboot/connection.ts` and `lib/reboot/pending.ts` (react-compiler preserve-manual-memoization and set-state-in-effect). A later row should fix them.
