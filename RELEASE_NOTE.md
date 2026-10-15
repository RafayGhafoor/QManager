# 🚀 QManager BETA v0.1.32 (Draft)

v0.1.32 is in progress. This release is shaping up as a polish and correctness pass. Notes below are provisional and will be rewritten before release.

## ✅ Improvements

- **Redesigned sign-in screen.** The sign-in card now leads with your modem's name, has a cleaner layout in light and dark mode, keeps the language and theme switchers in the corner, and shows a clear message if the modem can't be reached.
- **Failed sign-ins now show how many attempts remain.** If you're locked out, a countdown shows when you can try again, and it keeps counting if you refresh the page.
- **Repeated failed sign-ins now lock out progressively.** After five wrong passwords the form locks for 30 seconds, and each further failure after a lock expires waits longer, up to 15 minutes. A correct password or an hour without a failed attempt starts you fresh.
- **Sign-in errors now appear in your language.** Incorrect-password and lockout messages are translated instead of always showing in English.
- **The Live Traffic monitor has been removed.** Its readings were inaccurate and it kept a network port open on your LAN without a password. The System Settings page and the dashboard row are gone, and upgrading cleans everything up automatically, including the websocat package and port 8838.
- **More reliable modem readings and background services.** IP Passthrough settings and timing-advance readings now always come from the modem's answer, never from the echoed command, so they can no longer show a stale or default value. Background services now fall back safely instead of quitting silently if one of their helper files is missing.
- **5G bands are now labeled correctly in the Cell Scanner.** NR5G cells show an `N` prefix (`N41`, `N71`) instead of the LTE-style `B` prefix. LTE cells still use `B`.
- **5G channel bandwidth is now shown in MHz, not raw resource blocks.** The Cell Scanner's BW column converts each NR carrier's resource-block count to its true channel bandwidth using the subcarrier spacing — e.g. an n41 carrier now reads 90 MHz instead of 245 MHz. If the modem doesn't report a spacing for a cell, the raw block count is shown labeled "PRB" rather than a misleading MHz figure.
- **Locking a scanned 5G cell now uses the correct subcarrier spacing.** When the scan didn't report a spacing for a cell, the lock previously assumed 30 kHz — wrong for FDD bands like n71 and n25 (15 kHz). It now infers the right spacing from the band instead of mis-locking.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.31

**System Settings → Software Update.** No migration steps needed.

## 💙 Thank You

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.
