# 🚀 QManager BETA v0.1.33

v0.1.33 is a small follow-up to v0.1.32, built from your feedback. The dashboard now shows your last outage, how long ago it ended and whether your WAN IP changed when you reconnected, and the signal colours are easier to tell apart. It adds one feature and one visual fix.

## ✨ New Features

- **See your last outage on the dashboard.** The Connection Quality card has a new **Last outage** row showing how long your most recent drop lasted and how long ago it ended, for example "40s (2m ago)". Every drop counts, however short, even with alerts turned off. Tap the hint next to it to see the WAN IP you reconnected with and whether it changed. The row resets when the modem restarts.

## ✅ Improvements

- **Signal colours are easier to tell apart.** Signal readings such as RSRP, RSRQ and SINR, and their bars, now use plain green for good, yellow for fair and red for poor. The old olive and brown shades were hard to tell apart. The signal-bar icon beside each reading still shows excellent and good separately.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.32

**System Settings → Software Update.** No migration steps needed.

## 💙 Thank You

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.
