# Polish wave (U4.22, U4.23, B5.37)

Opened and closed 2026-10-19 (B5.37 `af8533bc`, U4.23 `537848ab`, U4.22 `d75e6569`, all merged into `development-home`). Ledger rows: `docs/rm520n-port-ledger.md` > U4 (U4.22, U4.23) and B5 (B5.21, B5.22, B5.37).

## Why this wave

Track U is closed (finishing wave, `79727096`) and the fork is still at `a05c4e92`. What is left that a user sees:

| Row | Surface | State today |
|---|---|---|
| U4.22 | Dashboard Device Metrics: Data Used pill + reset dialog (B5.21) and Storage row (B5.22) | Both dropped from Device Metrics in U4.10 because the target has no backend for them. Fork: `update_data_used` in the poller, `/usrdata/qmanager/data_used.json`, `network/data_used.sh`, `data_used_reset.sh`; modem-subsys/storage block in the poller, `system/modem-subsys.sh`, `use-modem-subsys` |
| B5.37 | Custom SIM Profiles: manual activation of a profile bound to another SIM | The row says "keeps its current settings until a matching SIM is inserted", but the activation already applied the profile (CID 1 rewritten). The copy is wrong, or the action should refuse or confirm |
| U4.23 | Canon close-out sweep | No open U row, but nobody has looked at the whole app at once since the waves merged. `DESIGN.md` > Migration Deltas is stale (says 30 `<Switch` files, now 4; Icons row still says "lucide on every route except the sidebar"; TTL & MTU `shapes.ts` listed as open but it landed with U4.20). The Copy row says "Not audited" |

Checked and not in this wave: no raw `duration-*` outside `components/ui/`, no outline status `Badge`, no `max-w-*` page cap, `react-icons` only in the documented exceptions. Three of the four remaining `<Switch` sites match the fork (`transcript-card`, `scheduled-operations-card`, `update-preferences-card`); `ipa-offload-card` is target-only. Goal rule: do not convert them unless a lane reworks that card.

## Lanes

Disjoint file sets, so the three run in parallel, one lead session per lane, each in its own worktree reset onto `development-home`. Each lead orchestrates its own team (Haiku recon, Sonnet builders, Opus for sensitive bits) and holds its own plan stop.

- **U4.22 Device Metrics restore: Large, plan stop.** Touches the poller (`qmanager_poller`), new CGIs, install/update/uninstall lockstep (new `/usrdata/qmanager/data_used.json`, reset flag cleanup), and the dashboard card. **The B5.29 poller 12 h soak started 2026-10-19 10:23; do not deploy a poller change to the modem before it ends (~22:23) and its result is recorded.** Must not undo B5.29 (fork-free hot path, fixed 2 s cycle, printf composer, `status.json` schema additive only, parity harness `tools/poller-parity/`). Data Used has to survive reboots and count both directions across the rmnet data interface(s) on the RM551E, which may differ from the RM520N fork; probe live first.
- **B5.37 SIM-mismatch activation: Large (profile apply path), plan stop.** Read `docs/features/custom-sim-profiles.md`. The plan offers the user the choice (copy fix only / confirm dialog before applying on a mismatched SIM / refuse) with a recommendation. No live activation on the shared modem without the user's OK.
- **U4.23 Canon close-out sweep: Small, frontend + docs.** Visual QA of every route in the browser preview (phone 375 and desktop, light and dark) against `DESIGN.md`; No-Debug-Build Copy audit across all five catalogs (exempt surfaces: AT Terminal, Logs, About Device diagnostics, System Health Check, the Prometheus scrape snippet); fix what is cheap and in-canon, list the rest as new B5 rows; refresh `DESIGN.md` > Migration Deltas to match the tree. No backend changes.

## Rules for every session

- Read `DESIGN.md`, `PRODUCT.md`, `CLAUDE.md`, the ledger row, this file, and the matching `docs/features/` or `docs/reference/` doc first. Fork files: `git show a05c4e92:<path>`.
- Fresh worktree: reset onto `development-home`, copy `.env` from the main checkout (confirm `git check-ignore .env`), `bun install` only for builds and `tsc`.
- Validate: `bunx tsc --noEmit`, eslint on touched files, `bun run i18n:check`, `bun run icons:check`, `bun run build`; for shell, the static audit (`.claude/check-crlf.sh`, BusyBox/POSIX, `jq` without regex) plus the on-device leg. Always `sync` after deploying files to the modem.
- Every new string in all five catalogs (en, zh-CN, zh-TW, it, id). Toasts per the Toast-Confirms Rule.
- Ledger: edit only your own row (the file is CRLF; edit bytes and add with `core.autocrlf=false`).
- Close: commit on your branch, report branch and status, and stop. The parent session merges (child sessions cannot merge into `development-home` in the main folder).
