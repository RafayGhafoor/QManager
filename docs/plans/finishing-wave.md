# Finishing wave (U4.19 to U4.21)

Opened and closed 2026-10-19 (U4.19 `da1cab89`, U4.20 `d8b292af`, U4.21 + U2.3 `832f7d0f`, all merged into `development-home`). Ledger rows: `docs/rm520n-port-ledger.md` > U4.

## Why this wave

After the cellular core wave, every Track U row in the ledger is closed, and `rm520n/development` is still at `a05c4e92` (no new source commits). A route-by-route sweep found three surfaces that the fork re-authored but that never got a U4 row:

| Row | Surface | Fork files (`git show a05c4e92:<path>`) | Target today |
|---|---|---|---|
| U4.19 | `/setup` wizard | `components/onboarding/{onboarding-shell,onboarding-wizard}.tsx`, `steps/*` (6 steps) | 9 files, 14 raw `duration-*`, old logo; band-lock step lacks the fork fix `578ddb2f` ("stop silently discarding a failed band lock"); target-only `steps/step-web-port.tsx` |
| U4.20 | `/local-network/ttl-settings` | `ttl-mtu-settings/{ttl-settings,ttl-mtu-strip,shapes,ttl-settings-card,mtu-settings-card}.tsx` | U4.1 ported only the `CardFoot` commit; no live strip, no `shapes.ts`, 2 `Switch`, hooks still inside the cards |
| U4.21 | Reboot and account chrome | `components/reboot/reboot-countdown.tsx`, `components/auth/change-password-dialog.tsx`, `app/not-found.tsx` | raw durations in `reboot-countdown` and `reconnecting-banner`; `change-password-dialog`, `password-requirements`, `strong-password-toggle` (target-only; `Switch` + `react-icons`); no 404 page at all |

Checked and not in this wave: System Health Check is already the fork version (B3.4), Prometheus was built in the canon (B3.7), the dashboard `network-status.tsx` lucide/`react-icons` glyphs are an explicit kept decision (comment in the file), `nav-user.tsx` action items stay lucide by canon. `max-w-*` inside cards and dialogs is a readability cap, not a page cap, and is allowed.

## Lanes

All three rows touch disjoint component trees, so they run in parallel, one session per row, each in its own worktree reset onto `development-home`.

- **U4.19 Setup wizard: Large, plan stop.** The wizard writes the admin password, band locks, network mode and the web port (a self-severing origin move). Recon reads both trees and the live modem (read-only), then writes `docs/plans/u4-19-setup-wizard.md` and stops for the user's OK before building. Testing the full wizard live needs a fresh-setup state; it must not reset the shared modem's password or port without the user's OK.
- **U4.20 TTL & MTU: Small flow, but live saves need OK.** Frontend only unless recon finds `network/ttl.sh` / `mtu.sh` contract drift against the fork (then it becomes Large and stops with a plan). An MTU or TTL save on the live modem changes the data path, so ask before doing one.
- **U4.21 Reboot and account chrome: Small.** Frontend only. Nothing in it may trigger a reboot; preview `/reboot/` with a stub or by direct navigation only. Also closes **U2.3**: audit its helper list (`carrier-aggregation`, `carrier-match`, `band-frequency`, `radio-info`, `schedule-timeline`, `ipv6`), mark each landed, still owed (with the consumer that would pull it) or SKIP, and close the row.

## Rules for every session

- Read `DESIGN.md`, `PRODUCT.md`, the ledger row, this file, and the matching `docs/features/` or `docs/reference/` doc first. Read the fork version with `git show a05c4e92:<path>`, and its `docs/reference/<page>.md` where one exists.
- Port intent, not diffs: keep target-only behaviour (web port step, deferred-reboot banner, `ReconnectingBanner`, password strength toggle) and any target-ahead fixes.
- Worktree reset onto `development-home`; copy `.env` from the main checkout (confirm `git check-ignore .env`); `bun install` for tsc and build.
- **Shared files:** each row adds keys only to its own namespace sub-tree in all five catalogs (en, zh-CN, zh-TW, it, id). The ledger and `DESIGN.md` Migration Deltas are shared, so edit only your own row. Rows merge into `development-home` one at a time; after each merge run `bun run i18n:check` and re-resolve if another row landed first.
- Canon: lucide on all three routes (none is in the Material scope); filled-chip / `Tag` split; `CardFoot` apply on editable cards (the wizard is exempt); toasts from returned results in all five catalogs; motion only from `lib/motion.ts`; no `max-w-*` page cap; three states with shape-constant skeletons; No Debug-Build Copy.
- Validate: `bunx tsc --noEmit`, eslint on touched files, `bun run i18n:check`, `bun run icons:check`, `bun run build`, and a browser preview at 1440 and 375 in light and dark. Any shell change gets the full static audit plus the on-device leg.
- Close the ledger row with commits and deviations; add Findings for anything learned.
- Models: plans on Opus 5.5 High; builds orchestrated on Opus medium with Sonnet 5.5 High builders; recon on Haiku 5.5. Sessions self-merge into `development-home` once validated, and never push.

## Not in this wave

B5.21 (Data Used counter), B5.22 (Storage meter), B5.34 to B5.37 (backend hygiene), and the owed live checks B5.14, B5.16 and B5.18. Each is its own session later.
