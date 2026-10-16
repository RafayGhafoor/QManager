# 🚀 QManager BETA v0.1.32 (Draft)

v0.1.32 is in progress, headlined by a much faster connection to the modem: every command now answers in about 10 ms instead of about 1 s, which makes every page and background service more responsive. It also brings redesigned sign-in and landing pages, cleaner Network Events, and a polish and correctness pass throughout. Notes below are provisional and will be rewritten before release.

## ✨ New Features

- **Modem commands are about 100× faster.** Each command to the modem now takes about 10 ms instead of about 1 s. Two changes add up: commands release the modem the moment they finish, and QManager now keeps one connection to the modem open instead of starting several helper programs for every command (a further 5× on its own). Pages and background services no longer queue behind each other, a modem that stops answering can no longer leave everything waiting for minutes, and a late answer can no longer show up in the wrong place. It also picks itself back up when the modem restarts, never sends the same command twice, and answers at once while a cell scan is running instead of waiting for the scan to finish.
- **New Host AT Ports setting.** **System Settings → Host AT Ports** stops a computer connected over USB or PCIe from sending AT commands to the modem. It's on by default, matching stock firmware.

## ✅ Improvements

- **Redesigned landing page.** The page you see before signing in now leads with whether the internet is up and how warm the modem is, then shows each carrier's signal strength on a colour-coded bar with a switch between signal power and signal quality, then your carrier, network type and total bandwidth. It also tells you plainly when the readings are stale or the modem is offline.
- **Redesigned sign-in screen.** The sign-in card now leads with your modem's name, has a cleaner layout in light and dark mode, keeps the language and theme switchers in the corner, and shows a clear message if the modem can't be reached.
- **Failed sign-ins now show how many attempts remain.** If you're locked out, a countdown shows when you can try again, and it keeps counting if you refresh the page.
- **Repeated failed sign-ins now lock out progressively.** After five wrong passwords the form locks for 30 seconds, and each further failure after a lock expires waits longer, up to 15 minutes. A correct password or an hour without a failed attempt starts you fresh.
- **Sign-in errors now appear in your language.** Incorrect-password and lockout messages are translated instead of always showing in English.
- **The Live Traffic monitor has been removed.** Its readings were inaccurate and it kept a network port open on your LAN without a password. The System Settings page and the dashboard row are gone, and upgrading cleans everything up automatically, including the websocat package and port 8838.
- **More reliable modem readings and background services.** IP Passthrough settings and timing-advance readings now always come from the modem's answer, never from the echoed command, so they can no longer show a stale or default value. Background services now fall back safely instead of quitting silently if one of their helper files is missing.
- **One outage, one lost and one restored entry.** Network Events no longer logs the same outage twice, and an outage the watchdog fixes on its own is now recorded and alerted like any other instead of slipping through. Slow-connection and packet-loss entries also wait until a problem has actually cleared before announcing recovery, and stay quiet right after the connection returns.
- **Carrier aggregation no longer floods Network Events.** A carrier that blinks out for a moment is ignored. A real change is announced once it holds, and a carrier that keeps flapping shows a single "churn detected" warning, followed by a "settled" entry once it calms down. Added-and-removed band lists also read correctly now.
- **SMS and email alerts share one wait time.** The number of minutes an outage must last before you are alerted is now a single setting used by both channels, so they can no longer disagree. Existing wait times carry over.
- **Alert failures now say what went wrong.** A failed save, test or uninstall on the Alerts page now shows the actual reason in your language instead of a generic message. The Activity list names each alert (connection lost, connection restored, modem rebooted, test message) in your language too.
- **Reboot alerts are recorded with the right time and cause.** If the modem's clock has not been set yet when it starts up, the reboot is now recorded once the clock is correct, instead of being logged in 1970 or mislabelled as unexpected. Email alerts also give up on a dead connection after 30 seconds instead of stalling.
- **"Degraded" now follows your packet-loss threshold.** The connection status turns to degraded at the packet-loss level you chose in Connection Quality, instead of a fixed 10%.
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
