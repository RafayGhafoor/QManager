# Device Access polish: Web Port rows + two-tab password card

Date: 2026-10-20. Scope: `/system-settings/device-access`. Status: approved and built 2026-10-20 (title "Passwords"; rate-limit gate on the web verify path and on-device deploy approved). The two CGIs were reviewed independently and deployed to the test modem.

## A. Web Port card (frontend only)

- Add a one-line description under **HTTP port** and **HTTPS port** (`ROW.CONSEQUENCE`, same as SSH rows), copy in all five catalogs:
  - HTTP: "Plain-text port for this interface and LuCI." (placeholder; final copy at build)
  - HTTPS: "Encrypted port for this interface and LuCI."
- Root cause of the big gap: `PORT_GRID` is a CSS `grid` inside `GROUP_FILL` (`flex-1`), so its rows stretch to fill the cell height. Fix in `shapes.ts`: `PORT_GRID` gets `content-start`, so rows keep their natural height with the same `gap-0.5` as every other row group. The skeleton uses the same shape constant, so it follows.

## B. Password card becomes two tabs (cross-layer)

The card (`ssh-password-card.tsx`, renamed `password-card.tsx`; title "Passwords") has two tabs, **Web Password** and **SSH Password**. They are the same component driven by a per-tab config (label, copy, verify call, change call).

Flow per tab:
1. Tab body shows one field: **Current web password** / **Current SSH password**, with the show/hide toggle. `CardFoot` has one **Continue** button (disabled while empty).
2. Continue calls a verify-only endpoint. A wrong password shows an inline error and stays on the card. A correct one opens the dialog.
3. Dialog: **New password**, **Confirm new password** (with match hint), **Enforce strong password** (`StrongPasswordToggle`), `PasswordRequirements`, Cancel and **Save**. Client-side policy checks stay inline.
4. Save re-sends the current password, which the server re-verifies. Closing or cancelling clears everything, including the typed current password.
5. SSH success: `toast.success`, dialog closes, the card resets. Web success: the session is destroyed server-side (existing behaviour), so the browser goes to `/login/` and that navigation replaces the toast.
6. The two tabs keep separate state, and switching tabs clears the other tab's typed value.

### Backend

- `system/ssh_password.sh`: accept `{"current_password":"...","verify_only":true}` with no `new_password`. It runs the existing shadow check and returns `cgi_success` without touching the password. The `missing_fields` check applies to `new_password` only when not verify-only. The `sleep 1` on a wrong password stays.
- `auth/password.sh`: same `verify_only` mode using `qm_verify_password`. It must NOT destroy the session in verify mode.
- Rate limiting: the web verify path is a password oracle for a logged-in session, so it goes through `qm_check_rate_limit` and `qm_record_failed_attempt` like `auth/login.sh`. A `429 rate_limited` response is handled in the UI with the existing error resolver. (The SSH path has no ladder today; it keeps its 1 s delay, and I'll note that rather than widen scope.)
- No new files, so installer, update and uninstall are unaffected (lifecycle lockstep holds).

### Frontend files

- `components/system-settings/password-card.tsx` (renamed from `ssh-password-card.tsx`) and a small `password-change-dialog.tsx` beside it.
- `hooks/use-ssh-password.ts`: add `verifyPassword`. `hooks/use-auth.ts`: add `verifyWebPassword`. Both return `{ success, message? }`.
- `types/ssh-password.ts`: `verify_only` request shape.
- `shapes.ts`: `PORT_GRID`, and a stack-row constant if the one-field row needs it.
- `device-access.tsx`: swap the import. Locales: en, zh-CN, zh-TW, it, id (`ssh.*` becomes `passwords.*`, plus new keys). Docs: `docs/reference/system-settings.md` (Device Access), `docs/API-REFERENCE.md`, release note if user-visible.
- Canon: `Tabs` (check the Traffic Engine grouped-card tab pattern), lucide icons (system-settings route), toasts per `toast-confirmation.md`, three states are N/A (no GET).

### Validation and rollback

- Static: CRLF check (`.claude/check-crlf.sh`), BusyBox/POSIX audit of both CGIs.
- On-device (needs your OK for live-state writes): deploy the two CGIs, probe verify-only with a wrong and a correct password for both tabs, and confirm neither changes a password or ends the session. A real change on the test modem only with your OK and a password you give me to restore.
- Frontend: `bunx tsc --noEmit`, lint on touched files, browser check at localhost with the in-app browser, five-locale key parity.
- Rollback: the CGI change is additive (a new optional field), so reverting the frontend alone leaves the old behaviour intact.

## Questions for you

1. Should the card title be "Passwords", or should the Web/SSH tabs sit under the existing "SSH Access" title? I'd use "Passwords".
2. OK to add the rate-limit gate on the web verify path (recommended), and OK to deploy and test the two CGIs on the modem?
