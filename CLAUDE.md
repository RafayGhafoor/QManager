## Device & Architecture Context

QManager is a Next.js (static export) frontend + OpenWRT CGI shell backend, deployed **onto the modem itself** (Quectel RM520N/RM551E/RM500Q-class running OpenWRT). Backend = BusyBox `/bin/sh` scripts under `scripts/www/cgi-bin/`, daemons under `scripts/usr/bin/`, shared libs under `scripts/usr/lib/qmanager/`. Modem talks via `qcmd` AT-command wrapper. Because the app runs on the device, anything that reboots the modem also kills any in-flight HTTP request — defer reboots via dialog + persistent banner, never `AT+CFUN=1,1` mid-request.

See `docs/ARCHITECTURE.md`, `docs/BACKEND.md`, `docs/FRONTEND.md`, `docs/API-REFERENCE.md` for full breakdowns.

## Change Workflow

Lean by default. The main session understands the change, writes it, and validates it. Agents are tools for heavy or parallel work, not mandatory hand-offs. This flow replaces the generic brainstorming, writing-plans and verification skills for code changes in this repo; test-driven development still applies where tests exist. **Only invoke `superpowers:brainstorming` when the user explicitly asks for it.**

### Two sizes

| Size | What it covers | Flow |
|------|----------------|------|
| **Small** | Typos, copy, single-file fixes, changes inside one layer that don't touch the risky areas below | Understand → change → validate. No plan, no approval stop. |
| **Large** | Cross-layer features; anything touching the **installer / `init.d` / UCI schema / firewall (fw4, nftables, DPI) / OTA / the AT path (`qcmd`, `atcli`, lock files)**; anything that can reboot the modem or cut the user's connection | Understand → **short plan, then stop for the user's OK** → build → validate → docs. |

The user can always say "just do it" / "skip the plan" to drop a large change to the small flow.

### The steps

1. **Understand.** Read the code path and the matching `docs/features/` doc. For every **bug fix** and every **large** change, also look at the **live modem** (read-only, via `mcp__modem__*`) before writing code. Past root causes repeatedly differed from the first theory. Do this directly; dispatch `modem-investigator` only for a broad sweep worth offloading.
2. **Plan (large only).** A short plan: files, build order, risks, how it will be validated, rollback. Stop for approval; plan changes are cheap here and expensive later.
3. **Build.** Write the code in the main session. Work bottom-up across layers: backend (poller / CGI / lib / init.d) → hook → component. Dispatch `backend-writer` / `ui-builder` only to parallelise independent file sets, never as a pre-flight round. UI craft goes through the Impeccable skill.
4. **Validate (mandatory for any shell change).** Run the static audit (CRLF via `.claude/check-crlf.sh`, BusyBox/POSIX, bashisms, multi-var `local`, `jq` null-handling and no regex, lock/trap discipline, numeric guards, CGI envelope, reboot/CFUN safety) **and** verify the deployed change on the modem. Use the `validator` agent or do it directly. After **2 failed rounds**, stop and ask the user instead of looping. Frontend changes: `bunx tsc --noEmit` and lint for the touched files.
5. **Docs (when behaviour, contracts or invariants changed).** Update the feature doc, the routing tables (here and in `docs/features/README.md`) and `RELEASE_NOTE.md` if the change is user-visible. Do it inline; `docs-writer` is for large doc work only.

### Hard rules

- **Validation is not optional for shell.** Static-only passes have shipped broken scripts before; do the on-device leg whenever the change is deployable.
- **No in-flight reboot.** Anything that calls `reboot` / `AT+CFUN=1,1` defers behind a dialog and the persistent deferred-reboot banner, never in a CGI response path.
- **Lifecycle lockstep.** A feature change keeps `install.sh`, update and uninstall in sync: file copy, UCI seed, daemon start, `/tmp` and reload-flag cleanup.
- **Live-state writes during investigation are a stop.** If understanding a bug needs a write on the modem, say so and get the user's OK first.
- **Agent briefs are self-contained.** A dispatched agent doesn't see this conversation: inline the paths, schemas, live evidence and relevant canon.
- **Never auto-merge.** At the end, report the branch and git status, and ask whether to merge, keep for a PR, or discard.

### Worktrees

Use a worktree when the work is large or another session may touch the same branch: `EnterWorktree` after the plan is approved, then reset it onto `development-home` (it branches from `origin/main` by default). A fresh worktree needs two things: copy `.env` from the main checkout (and confirm `git check-ignore .env`; never commit it), and run `bun install` only if a frontend build or `tsc` pass is needed. Small changes stay in place. Give parallel agents `isolation: "worktree"` only when their file sets overlap.

### "Orchestrate"

When the user says **"orchestrate"**, run the same steps but delegate more: parallel recon (Haiku, medium effort) and parallel builders for independent pieces, with the main session planning, judging the reports with its own targeted reads, and holding the approval stop. It still ends with validation (and docs for large changes).

### Agents (`.claude/agents/`, models pinned per agent)

- `modem-investigator` (Haiku 5.5, medium): read-only stack trace and live-modem probe; returns evidence, never code.
- `backend-writer` / `ui-builder` (Opus): builders for parallel or offloaded implementation.
- `validator` (Sonnet): static BusyBox/CRLF/`jq` audit plus scoped on-device verification.
- `docs-writer` (Sonnet): larger documentation work.

## Design Context

`PRODUCT.md` (what QManager is, users, brand, principles) and `DESIGN.md` (tokens, typography, status chips, layout, motion, Do's and Don'ts) are the canon — **read them before any UI or product-facing work.** The canon is the RM520N fork's design system, adopted wholesale on 2026-10-15 with no target exceptions (port ledger `docs/rm520n-port-ledger.md`, U0.1 to U0.3). `DESIGN.md` is binding for all new work and is **ahead of the code**: its **Migration Deltas** section lists, row by row, where the target still has the old design (outline status badges, lucide-only routes, the old primitives) and which ledger item closes each gap. The fork's `/dashboard` and `/cellular/` index (`components/dashboard/**`, `components/cellular/radio/**`; read with `git show a05c4e92:<path>`) are the reference implementations when a rule is ambiguous. A primitive the canon names that is not in `components/ui/` yet is created by the ledger row in Migration Deltas, not faked with the old pattern (`segmented-field`, `metric-bar`, `tick-group`, `ticking-value` and `swap-label` landed with U2.1b).

Rules the build and review enforce most often — the detail and rationale are in `DESIGN.md`:

- **Status chips** are filled tonal `Badge` variants (`success` / `warning` / `destructive` / `info` / `muted`) from `components/ui/badge.tsx`, each with a `size-3` icon — `success-container` and `warning-container` measure 1.03:1 apart, so the glyph is the only separation. Never `variant="outline"` for status, never hand-written classes, never two states sharing a glyph. Identity and metadata (band, radio family, capability, slot) are `Tag`s from `components/ui/tag.tsx`, not badges; the split is compiler-enforced through `BadgeVariant`. (Ledger U2.4 flipped the target's outline-plus-alpha badges and `ServiceStatusBadge` on 2026-10-16. New work uses the canon form.)
- **Measured signal quality** lives on numerals and bars through one quality-to-colour map (`components/cellular/signal-quality-display.ts`, lands with U2.3), never on chip fills; ramp ink without a bar beside it is a bug; a missing reading is an empty track.
- **CardHeader** is plain `CardTitle` + `CardDescription`, no icons. Primary actions use the default button variant; saves go through `SaveButton` with a translated label.
- **Card-Foot Apply Rule** (adopted 2026-10-15; supersedes the old page-level and sticky save bars): a card that edits a draft commits it from `CardFoot` (`components/ui/card-foot.tsx`), a persistent borderless row on the card's bottom edge. Status on the left; Discard and secondary actions (ghost or `tonal-neutral`, never a stroked `outline`) then `SaveButton` last on the right. Never a mid-card Save, a bar under the card grid, or a sticky bar. Exempt: dialogs and wizards, per-row and inline actions, operational actions. The sweep of existing cards is ledger U4.1 (Watchdog U4.6, Alerts U4.9); new and reworked editable cards use it now, and an apply spanning several cards sits on the card it belongs to most.
- **Confirmations are toasts** (Toast-Confirms Rule): every user-initiated mutation that finishes (save, apply, persistent toggle, add, delete, reset, install, copy) fires one `toast.success` / `toast.error` — plain `sonner`, one sentence, `t()` copy with the key in **all five** catalogs (en, zh-CN, zh-TW, it, id), handler-level, at the terminal moment. The failure reason comes from the call's returned result (a backend error code through `resolveErrorMessage`, `docs/features/error-codes.md`), never from hook `error` state read after an `await` (stale closure). Effect-based toasts carry a deterministic sonner `id` and never fire for a result merely loaded on mount. Copy goes through `lib/clipboard.ts` `copyText` (lands with U2.3). A fading "Applied"/"Saved" chip is retired (`SaveButton`'s own Saved flash stays). Exception: a mutation that ends in navigation (the `/reboot/` hand-off, Change Password's redirect to `/login/`) or advances a `/setup` step keeps that transition as its success signal and still toasts failures. Never toast polling, background work, draft edits, or Discard. Traps and the target's status: `docs/reference/toast-confirmation.md`.
- **Segmented pills**: a boolean preference or a short mutually-exclusive choice uses `SegmentedField` (`components/ui/segmented-field.tsx`; the caller passes the check glyph through the required `glyph` prop), not a bare `Switch`. New and reworked surfaces only: the 30 files still on `<Switch` are not converted unless you are reworking that page.
- **Fact-Is-Info:** a fact worth knowing that is neither a fault nor health is a filled `Badge variant="info"` with a glyph, shown only while it applies. Never a grey outline (reads as disabled), amber (a problem) or green (healthy). On a promoted `primary-container` row the chip dissolves into the row (`DESIGN.md` > Colors; `docs/reference/color-system.md`).
- **Typography:** Rethink Sans for UI including every figure (`tabular-nums`); JetBrains Mono only for opaque strings. The test is "a quantity you read, or an opaque string you compare?" — EARFCN / NR-ARFCN / PCI / band / TAC are quantities (Rethink); ICCID / IMEI / MAC / IP / paths / interface names / raw AT output stay mono even when all-digit. **Fonts are vendored** under `app/fonts/` via `next/font/local`; **never `next/font/google`** — it fetches from Google Fonts on every cold build, so a slow or absent link fails the build, and the device has no guaranteed egress. Vendored by ledger **U1.3**; do not add another face. **Shape:** 8/10/12/16/20px plus pill — `rounded-card` in a grid, `rounded-hero` for the anchor, `rounded-pill` for anything that acts or labels; `card-sheen` (dark-only) belongs to the `Card` root and to every floating surface over a scrim (`DialogContent`, `AlertDialogContent`, `SheetContent`, `DrawerContent`), never an inner tile.
- **Scanning Rules** (`PRODUCT.md` Principle 8): surfaces are scanned, not read. Every element sits on two edges (receipt rows: key left, value right); fix a hard-to-scan list by grouping and varying it, not padding it; a glyph replaces text only if it needs no tooltip; defaults render quiet; at most one inner container per card. Goal rules — don't sweep untouched pages.
- **Full-Width Page Rule (hard):** never wrap a feature page in `max-w-*`; a card drawn for a phone recomposes on a wide card (`@5xl/card:` — the card declares `@container/card` at the call site; `Card` does not); cap readability inside a card. This replaces the old uniform two-column settings grid. **Card-Wrapped Surface Rule:** a feature's settings live inside one self-contained `Card` that the page arranges, never loose fragments on a full-bleed page (`PRODUCT.md` Principle 4, `DESIGN.md` > Layout).
- **Copy & Help** (`PRODUCT.md` Principle 7): convention over explanation; one sentence per page/card description. Jargon and non-dangerous caveats go behind `HintIcon` (a `Popover` toggletip, never `Tooltip`; Material glyph on every route) — about one per settings group, and no tip is the default. Consequences stay visible.
- **No Debug-Build Copy**: user-facing text never exposes implementation detail — no config file paths (`/etc/qmanager/...`, `/tmp/qmanager_*`), no "Read back from…" / "Saved to the modem" provenance lines, no script, CGI, daemon, UCI or AT-command names — unless the surface exists to show them (AT Terminal, Logs, About Device diagnostics, System Health Check). It makes QManager read as a debug build. Provenance lives in the code comment or `docs/`, not the card; a real fault still gets a plain-language message. Applies to `t()` strings, hardcoded literals, tooltips and placeholders. Before shipping UI copy, grep the diff for `/etc/`, `/tmp/`, `uci `, `AT+`, `read back`, `saved to`.
- **Responsive** through container queries (`@container/main` or a card-local one); viewport breakpoints only for the page gutter and shell. **Three states** on every data surface — loading, empty, error — with skeletons importing the loaded shape constant, never restating numbers.
- **Motion** comes from `lib/motion.ts`, which mirrors `globals.css` (`quick` 360 / `standard` 600 / `emphasized` 800 ms); a raw `duration-200`, `{ duration: 0.25 }` or bare `transition-all` is a bug. Retune both layers together. "Is motion reduced?" is answered only by `useMotionReduced()` / `isMotionReduced()` (ESLint-enforced; `docs/reference/motion-preference.md`). The scale, the preference resolver and the lint rule landed with ledger **U2.2** (CSS tokens with U1.2); `lib/motion-presets.ts` is gone, and ESLint rejects `useReducedMotion` and raw `prefers-reduced-motion` reads.
- **shadcn/ui primitives first**, custom components only where none exists; semantic colour tokens only, never raw Tailwind colours.
- **Icon boundary:** Material Symbols Rounded (self-hosted subset) is scoped to the sidebar, `/dashboard`, the pre-auth `/` and `/login/`, and all of `/cellular/**` (Custom SIM Profiles and Connection Scenarios included); `/setup`, `/local-network/**`, `/monitoring/**`, `/system-settings/**`, `/about-device`, `/support` and the header bar stay on lucide-react. `Banner`, `SaveButton` and `sonner` mount on every route and are pinned lucide; `HintIcon` renders Material on every route. Never mix both sets on one screen, and don't extend the boundary without a deliberate decision. `MaterialSymbol` sets `fontSize` inline, so pass `size` at every call site. A glyph name the type permits but the subset lacks renders as literal text and does **not** fail the build: `bun run icons:check` catches it, and `bun run icons:subset` needs network access to Google Fonts. The font, names list and `icons:*` scripts landed with ledger U1.3 (`bun run package` runs `icons:check`); the component landed with U2.1a; the target is lucide-only until each route converts whole in its own U3 / U4 row. See `docs/reference/icon-system.md`.
- **Colours are role-based:** `--primary` (hue 262) is the one hue that acts — brand, action, the `info` role and 5G NR identity. `--lte` is identity only, `--downlink` / `--uplink` mean direction and nothing else (a count or a capacity is neutral), `--spatial` is antennas and MIMO, and only success / warning / destructive mean a verdict. Identity and direction never mean "healthy". Values and measurements: `docs/reference/color-system.md`. The old "Signal Indigo single accent" naming and the lighter-indigo `--secondary` control surface are retired; shadcn `--secondary` is a neutral.
- **Target-only surfaces are not exceptions** (Netbird, Config Backup / Restore, Adaptive Polling, Traffic Engine, Connection Scenarios, Custom SIM Profiles, the deferred-reboot banner): they follow every rule above, are re-authored one per row (ledger U4.11), and `DESIGN.md` > Components > Target-only surfaces holds the canon written for them. Connection Scenarios has no gradients; a settings page is no longer a uniform two-column grid; identity is a `Tag`, not plain muted text. Anything that reboots the modem still defers behind a dialog plus the persistent banner, never mid-request.

## Probing the Live Modem (Development)

A live test modem is reachable on the LAN; **SSH credentials live in `.env`** (`SSH_HOST`, `SSH_USERNAME`, `SSH_PASSWORD`). When debugging backend behavior, reproducing CGI output, verifying a shell-script change actually runs under the device's BusyBox `/bin/sh`, or sanity-checking that a fix landed on disk, probe the device rather than guessing from code alone.

**Prefer the modem bridge** (`mcp__modem__*`, a local MCP server at `tools/modem-mcp/`, registered in `.mcp.json`). It holds one persistent SSH connection, reads `.env` itself (secrets never enter the transcript), auto-reconnects and enforces per-call timeouts:

- `modem_exec(command, timeout_s?, stdin?)` returns `{stdout, stderr, exit_code}` (default 30 s, max 600 s). stdin is `/dev/null` unless `stdin` is passed (drive a REPL with e.g. `stdin: "quit\n"`; `qmi_simple_ril_test` ignores EOF). The timeout is enforced on the device: the whole process tree is killed and the result carries `timed_out: true` plus `orphans` (survivors, normally empty). Cancelling a call kills the tree too.
- `modem_ps(pattern?)` / `modem_kill(pid | pattern, signal?)` list and kill processes without `pkill`; PID 1 is refused, and more than 5 pattern matches need `confirm: true`.
- `modem_read(path, max_bytes?)` returns the file content and its real size.
- `modem_write(path, content, mode?, mkdir?)` streams content into `cat > path` (no SFTP or base64 needed), strips CRLF, chmods (755 for `.sh`), runs `sh -n` on shell scripts and returns the byte count plus the syntax result. This replaces the chunked base64 deploy.
- `modem_cgi(endpoint, method?, body?)` curls `http://127.0.0.1/cgi-bin/quecmanager/<endpoint>` on-device with a throwaway session it mints and deletes, so authed endpoints work.

A server-side deny-list refuses `reboot`/`poweroff`/`halt` in command position, `AT+CFUN=1,1`, `firstboot`, factory resets, `rm -rf /`, `opkg remove` and raw `mtd`/`dd` writes unless the call passes `confirm: true`, which is only for an action the user explicitly approved. Setup: `cd tools/modem-mcp && bun install` once; `bun run smoke.ts` there is a live read-only smoke test. The UCI package on the device is `quecmanager` (`uci show quecmanager`).

Fallback when the bridge is unavailable: PowerShell's **Posh-SSH** (`Install-Module Posh-SSH -Scope CurrentUser`), reading the variables from `.env` and never echoing them:

```powershell
$cred = [pscredential]::new($env:SSH_USERNAME, (ConvertTo-SecureString $env:SSH_PASSWORD -AsPlainText -Force))
$sess = New-SSHSession -ComputerName $env:SSH_HOST -Credential $cred -AcceptKey -Force
(Invoke-SSHCommand -SessionId $sess.SessionId -Command 'uci show quecmanager').Output
Remove-SSHSession -SessionId $sess.SessionId | Out-Null
```

Use it to: read live UCI config, inspect `/tmp/qmanager_*.json` runtime state, tail `/tmp/qmanager.log` and other logs, hit a CGI endpoint, check lock files (`/var/run/qmanager_*.pid`, `/tmp/qmanager_*.lock`), exercise `qcmd` AT calls, confirm `nft list ruleset` after a DPI toggle, verify init.d state, deploy a script under test, and re-read written config after an apply.

**Safety:**
- Treat the modem as a live system. Avoid destructive commands (reboots, `AT+CFUN=1,1`, factory resets, package removals, `rm -rf`) without a stated reason.
- Never echo `.env` values back to the user or paste them into transcripts; reference the variable names instead.
- `.env` should remain gitignored. Verify with `git check-ignore .env` before committing anything in the repo root.

## Release Notes (`RELEASE_NOTE.md`)

Structure:
1. **One-paragraph summary** immediately after the version heading — 2–3 sentences max. State the release theme (e.g. "focused on X"), call out the headline feature(s), and note whether this is mainly new features, fixes, or polish. No bullet points here.
2. `## ✨ New Features` — headline additions only; short user-facing bullets, no internal function names.
3. `## ✅ Improvements` — fixes and polish; same bullet style. Headline fixes first.
4. `## 📥 Installation` — one-line fresh install command + Software Update upgrade path.
5. `## 💙 Thank You`

## Shared Constants
- **`ANTENNA_PORTS`** (`types/modem-status.ts`): canonical metadata for 4 ports (Main/PRX, Diversity/DRX, MIMO 3/RX2, MIMO 4/RX3). Used by `antenna-statistics` + `antenna-alignment`. Do not duplicate.

## Feature Docs — Read On Demand

Detailed per-feature notes (apply pipelines, lock layering, contracts, gotchas, error codes) have been extracted to `docs/features/`. **Before editing any of these features, read the matching doc first** — they contain non-obvious invariants that aren't visible from the code alone.

| If you're touching… | Read |
|---|---|
| Traffic Engine (unified Video Optimizer + Masquerade, `/local-network/traffic-engine`), `nfqws`, NFQUEUE 200, `/etc/nftables.d/12-mangle-qmanager-dpi.nft` | [`docs/features/dpi-settings.md`](docs/features/dpi-settings.md) |
| Custom SIM Profiles, `qmanager_profile_apply`, `profile_mgr.sh`, Verizon MPDN, ICCID auto-apply, profile lock files | [`docs/features/custom-sim-profiles.md`](docs/features/custom-sim-profiles.md) |
| Config Backup / Restore, `.qmbackup`, `qmanager_config_restore`, `config_backup_sections.sh`, deferred-reboot banner | [`docs/features/config-backup-restore.md`](docs/features/config-backup-restore.md) |
| Language packs, i18n loading, `qmanager_language_install`, `language_packs.sh`, manifest, `bun run package:lang` | [`docs/features/language-packs.md`](docs/features/language-packs.md) |
| Backend error envelopes, `resolveErrorMessage`, `errors.json`, `at-commands` namespace | [`docs/features/error-codes.md`](docs/features/error-codes.md) |
| Tower locking, `qmanager_tower_failover`, signal failover daemon, failover spawn gating | [`docs/features/tower-lock-failover.md`](docs/features/tower-lock-failover.md) |
| `/cellular/antenna-alignment`, alignment meter, antenna type toggle | [`docs/features/antenna-alignment.md`](docs/features/antenna-alignment.md) |
| Connection Scenarios, `qmanager_scenario_schedule`, `scenario_mgr.sh`, `qmanager_profile_scenario` cron, band locking per profile, `scenario_locked_by_schedule` | [`docs/features/scenario-profile-binding.md`](docs/features/scenario-profile-binding.md) |
| SMS inbox/send/delete (`cellular/sms.sh`), patched `sms_tool`, `/dev/smd11` invariant, `AT+CPMS` storage routing, dual ME+SM merge, `qmanager_sms_storage` boot daemon | [`docs/features/sms.md`](docs/features/sms.md) |
| Alerts (unified SMS + email + reboot connection alerts, `/monitoring/alerts`), `alert_engine.sh` (downtime state machine following `ev_link_state` from `events.sh`, not frozen by watchdog recovery; ONE wait for all channels = UCI `quality_thresholds.alert_after_min` via `cq_alert_after_min`; + `alert_engine_reboot_detect`/`_ae_reboot_check` reboot detection+delivery), `alert_routing.sh` (v2 routing matrix incl. `reboot`), `monitoring/alerts.sh`, `alert_routing.json`, `use-alerts.ts`, trigger×channel routing/capability matrix, `record_planned_reboot` (`qlog.sh`) + shared `/etc/qmanager/crash.log` reboot ledger (tier4-only vs all-cause consumers), `boot_id`-based reboot detection (held while the clock reads 1970, `_AE_SANE_EPOCH`), Recent Reboots history card, log `trigger` keys + `triggerLabelKey`, `AlertsMutationResult` (toast the returned reason) | [`docs/features/alerts.md`](docs/features/alerts.md) |
| APN Settings (single-APN model), `cellular/apn.sh`, `apn_mgr.sh`, `apn_profiles.json`, `use-apn-settings.ts` / `types/apn-settings.ts`, COPS apply, boot reconcile, "Not live" badge | [`docs/features/apn-management.md`](docs/features/apn-management.md) |
| Band Locking, `bands/current.sh`, `bands/lock.sh` (band_type `lte`/`nsa_nr5g`/`sa_nr5g`/`nrdc_nr5g`), `qmanager_band_failover`, `supported_bands.env` / `supported_bands_hw.env`, `policy_band`, `refresh_policy_band` | [`docs/features/band-locking.md`](docs/features/band-locking.md) |
| Known-SIMs database, `sim_db.sh`, `known_iccids` set, `system/known_sims.sh` CGI, `known-sims-row.tsx` | [`docs/features/known-sims.md`](docs/features/known-sims.md) |
| Connection Quality settings, `qmanager_ping` daemon, `conn_state.sh` (shared ping-cache reader + profile table), ICMP probe (IPv4-primary/IPv6-fallback), `detect_ping6`, `probe_cycle`, `last_family`, `target_ipv4`/`target_ipv6` UCI, ping profiles, `system/ping_profile.sh` + `system/quality_thresholds.sh` CGI, `quecmanager.ping_profile.*` / `quecmanager.quality_thresholds.*`, `avg_latency_ms`, DNS lookup time (`/tmp/qmanager_dns.json`, `dns_lookup_ms`, `read_dns_data`), `events.sh` `detect_data_connection_events` (the single link/quality detector, `ev_link_state`, poller-called every cycle), `_ev_settle`/`_ev_ca_check` (`ca_change` debounce), `alert_after_min`/`cq_alert_after_min`, `connectivity.thresholds` + `degraded` cut | [`docs/features/connection-quality.md`](docs/features/connection-quality.md) |
| LAN Gateway/Subnet editor, `network/lan_config.sh`, `use-lan-config.ts`, `lan-config-card.tsx`, `lan_address_changed`, self-severing apply | [`docs/features/lan-config.md`](docs/features/lan-config.md) |
| Connection Watchdog, `qmanager_watchcat`, `monitoring/watchdog.sh`, `use-watchdog-settings.ts`, dual-trigger (reachability + quality), recovery ladder, SSR-aware hold, SIM-failover lifecycle, auto-failback (`primary_recheck_*`) | [`docs/features/connection-watchdog.md`](docs/features/connection-watchdog.md) |
| SMS Forwarding, `qmanager_sms_forward` daemon, `cellular/sms_forwarding.sh`, `forwarding-center.tsx`, `quecmanager.sms_forwarding.*` | [`docs/features/sms-forwarding.md`](docs/features/sms-forwarding.md) |
| Tailscale VPN, `vpn/tailscale.sh`, official + tiny install variants, procd init.d heredoc, `set_exit_node`, marker-file contract, `migrate_tailscale_packages` | [`docs/features/tailscale-vpn.md`](docs/features/tailscale-vpn.md) |
| Diagnostics capture, `system/diagnostics.sh`, `qmanager_debug_report` daemon, IPA offload toggle (`system/ipa_offload.sh`, `r8125_ioss.init`), armed-on-reboot, `pending_reboot_required` | [`docs/features/diagnostics.md`](docs/features/diagnostics.md) |
| Adaptive Polling, `qmanager_poller`, `system/adaptive_polling.sh`, `quecmanager.poller.*`, `.device.poller_tier` (active/idle/deep), `/tmp/qmanager_force_tier2`, `write_cache` always-run invariant, deep=QENG-only | [`docs/features/adaptive-polling.md`](docs/features/adaptive-polling.md) |
| AT broker / AT path: `qcmd` (now a symlink), `qmanager_atd` (Rust broker, `native/qmanager_atd/`), `qcmd.sh` (legacy engine), `at_engine.sh`, `/var/run/qmanager_atd.sock`, `quecmanager.at.engine`, host AT ports / `port-bridged` / `quecmanager.ports.host_at`, `system/at_engine.sh` + `system/host_at_ports.sh` | [`docs/features/at-broker.md`](docs/features/at-broker.md) |
| IP Passthrough (IPPT), `network/ip_passthrough.sh`, `/etc/qmanager/ippt_config.json`, `parse_ippt_*` in `parse_at.sh`, Verizon profile lock, apply-then-reboot one-shot, `.device.ippt_*`, connected-device MAC picker (`network/lan_devices.sh`, `use-lan-devices.ts`) | [`docs/features/ip-passthrough.md`](docs/features/ip-passthrough.md) |
| On-Demand Radio Details, `cellular/radio_details.sh`, `ondemand_radio.sh` lib, `/tmp/qmanager_ondemand.json`, RAT-gate hardening, `useRadioDetails`, `stale:true` fallback | [`docs/features/ondemand-radio-details.md`](docs/features/ondemand-radio-details.md) |
| Custom DNS, `network/dns.sh`, `dhcp.lan.dns`, odhcpd RA RDNSS, `use-dns-settings.ts`, provider presets (`dns-providers.ts`, `matchProvider`), `/etc/qmanager/dns_mode`, IPv6 two-stage BusyBox gate | [`docs/features/custom-dns.md`](docs/features/custom-dns.md) |
| Bandwidth monitor (**retired** 2026-10-15): `websocat:8838`, `qmanager_bandwidth`, the `retire_bandwidth_monitor()` upgrade cleanup in `install.sh` | [`docs/features/bandwidth-monitor.md`](docs/features/bandwidth-monitor.md) (retired stub) |
| Login rate limiting / lockout ladder, `cgi_auth.sh` `qm_check_rate_limit`/`qm_get_rate_limit_status`, `auth/login.sh`, `auth/check.sh` (read-only invariant), `useLogin` lockout, `/tmp/qmanager_auth_attempts.json` | [`docs/reference/auth-rate-limiting.md`](docs/reference/auth-rate-limiting.md) |
| Pre-auth `/` splash, `app/page.tsx` gate, `public/overview.sh` / `public/hostname.sh`, `overview-card`, `components/public/overview/*`, `resolveBodyMode`, `signal-quality-display.ts` | [`docs/reference/overview-splash.md`](docs/reference/overview-splash.md) |

Quick CGI / hook / type / reboot table for all extracted features lives in [`docs/features/README.md`](docs/features/README.md).

If you add a substantial new feature with non-obvious invariants, drop its notes into `docs/features/<feature>.md` and add a row above rather than re-fattening this file.
