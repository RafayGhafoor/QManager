# Traffic Engine v2 — build plan

Scope: frontend only, `/local-network/traffic-engine`. Built in worktree branch
`claude/traffic-engine-redesign-c429b1` (cut from `development-home` at `c7fa8893`).
Source of truth: the approved v2 prototype (three cards, in-card views) plus changes A–D.

## Three decisions for you

### 1. Hostname grouping → static frontend map (recommended)
- New `components/local-network/traffic-engine/video-services.ts`: domain → service
  label, built from the 12 section comments in `scripts/etc/qmanager/video_domains_default.txt`.
- Domains the map doesn't know (anything the user added) go in a **Custom** group, listed first.
- No CGI change, so no backend deploy or on-device step. The trade-off: if someone edits the
  defaults file, the map must be updated too. I'll add a comment in both files pointing at each other.
- The alternative (grouped GET response from `network/video_optimizer.sh`) needs a CGI change
  and an on-device check. I'd only do it if you ask.

### 2. CardFoot Discard / Apply comes back (supersedes `720485b9`)
- That commit dropped the foot and committed strength and domain on blur. The approved design
  brings it back, following the Card-Foot Apply Rule: strength and disguise domain are drafts,
  and **Discard + Apply** in `CardFoot` commit them.
- The mode switch (Off / Video Optimizer / Masquerade) and Hotspot bypass still apply instantly
  and toast.
- Apply toasts; Discard doesn't. Commit-on-blur goes away.

### 3. How I read A–D
- **A. No trailing "…"** on any label on this surface. That covers "Restore defaults", "Remove",
  "Starting", "Stopping", "Switching", "Applying", "Verifying", "Testing", "Installing" and
  "Saving", plus the install step messages. SaveButton's saving label is passed in without "…";
  the shared default for other pages stays as it is.
  - This departs from PRODUCT.md Principle 7, where a trailing "…" means a dialog follows.
    Restore defaults and Remove both open dialogs. I'll note the departure in `dpi-settings.md`.
  - I read "ellipses" as the text "…", not CSS overflow truncation. Domains wrap rather than
    truncate, so the list shows no ellipses either way.
- **B. No chip when the engine is idle.** The Engine card's CardAction is empty. The busy
  chip (info, spinning) and the running chip (success) stay.
- **C. Hostnames view, simplified:**
  - one column, grouped under quiet section labels, Custom first;
  - 40px rows with the domain in mono 13px at full ink;
  - remove button always visible (44px target on coarse pointers);
  - add-domain field on top;
  - Import / Export move into a `⋯` overflow menu in CardAction next to Back. They exist today,
    so I'm keeping them, just out of the toolbar;
  - no per-row Custom tags, since the group label says it;
  - group counts are a muted `tabular-nums` figure beside each label;
  - the list scrolls inside the card, so the Video Optimizer / Masquerade pair stays equal height.
- **D. No "No changes" text.** A clean draft leaves the CardFoot status slot empty. The slot
  and the `min-h-16` row stay so nothing jumps, and Apply / Save stays disabled. This applies to
  the Video Optimizer, Masquerade and Hostnames feet. The hostnames idle summary
  ("33 domains (2 custom)") goes too; the per-group counts carry that information.

## Build order (main session, Impeccable craft)
1. `shapes.ts` (new geometry constants) and `video-services.ts`.
2. Primitives local to the page:
   - `packet-chart.tsx`: 60 s area chart, uplink ink, null gaps, 500 floor, live pulse;
   - `handshake-strip.tsx`;
   - `metric-row.tsx`, `drill-row.tsx`, `check-row.tsx` (reworks `engine-check-row`).
3. `engine-card.tsx`: Live view (3-way SegmentedField with a Select fallback, metrics, Package
   drill, Hotspot row) and Package view (Remove + confirm).
4. `mode-card.tsx`: shared shell for Video Optimizer and Masquerade, with the strip, metrics,
   setting, check row and CardFoot. Plus `hostnames-view.tsx`.
5. `traffic-engine.tsx` composer:
   - drop the Tabs and the takeover AlertDialog;
   - `?mode=` now scrolls to and highlights that card; the old route redirects stay;
   - keep the `pending` / 8 s safety net, the refresh-both-hooks rule and TTL ownership;
   - add an install success toast.
6. Delete superseded files: `engine-status-card`, `cdn-hostlist-card`, `engine-enable-row`,
   `draft-status`, the onboarding parts the hero replaces, and anything else left orphaned.
7. Copy in `public/locales/*/local-network.json`, all five locales. zh-TW comes from zh-CN via
   OpenCC s2twp.

I'll do it all in this session. A Haiku pass for the i18n backfill only if it saves tokens.

## Validation
- `bunx tsc --noEmit`, eslint on the touched files, `bun run i18n:check`, and
  `bun run icons:check` if any Material glyph is added.
- Browser preview with fixtures: desktop and 375px, light and dark, Reduced motion. States to
  check: off, Video Optimizer running, Masquerade running, busy, missing packet queue, not
  installed, error, loading.
- Grep the diff for debug copy: `/etc/`, `/tmp/`, `uci `, `AT+`, `read back`, `saved to`.
- No live-modem writes.

## Docs and commits
- `docs/features/dpi-settings.md`: rewrite the Frontend layout section (three cards, in-card
  views, the CardFoot return, A–D, the static service map). Add a RELEASE_NOTE line.
- Atomic Conventional Commits as each step lands. No merge: at the end I report the branch and
  status and ask whether to merge, keep for a PR, or discard.

## Risks / rollback
- Deep-link behaviour changes from "switch tab" to "scroll to card". Low risk.
- Everything is on one branch, so rollback means discarding it.
