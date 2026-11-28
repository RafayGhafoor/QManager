# 🚀 QManager BETA v0.1.36-suncomm7

This release makes Cell History easier to read at a glance and adds 5G transmit power. Every signal line is now coloured by how good the reading was at that moment, so a bad stretch stands out in red without hovering. The Connection Quality full view also gains timestamps on each of its charts.

## ✨ New Features

- **Colour by quality on every chart.** RSRP, RSRQ, SINR (including each carrier), antenna ports, channel quality, modulation, transmit power, latency, jitter, packet loss, temperature, CPU and memory are drawn green when good, amber when fair and red when poor, point by point. A Good / Fair / Poor key explains the colours, and tooltip swatches follow the same colours. Lines stay distinguishable by their dash pattern and label.
- **5G transmit power.** Cell History now records 5G transmit power alongside LTE, drawn as two lines on the TX power chart (LTE dashed, 5G solid). Like the other radio detail readings, it is only recorded when the extra radio reporting is switched on.

## ✅ Improvements

- **Timestamps on every Connection Quality chart.** The latency, jitter and packet loss charts in the full view now carry their own time axis, like the Cell History charts, instead of relying on the strip at the bottom.
- **More languages covered.** The new text is available in English, Simplified Chinese, Traditional Chinese, Italian and Indonesian.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.36-suncomm6

**System Settings → Software Update.** No migration steps needed. Existing Cell History records stay readable; 5G transmit power starts appearing about a minute after the update if radio reporting is on.

## 💙 Thank You

Thank you to everyone who asked for bad moments to be visible without hunting for them.

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

---

# 🚀 QManager BETA v0.1.36-suncomm6

Cell History has been rebuilt from the ground up, and Connection Quality now keeps a full day or more of history that survives reboots. Cell History records every band your modem aggregates, not just the primary one, and adds modulation, rank, channel quality, how much of the cell your device gets under load, antenna balance and router restarts, with 7 and 30 day views that open quickly. It also fixes a bug that silently stopped recording once storage filled up. The dashboard gains an antenna warning when a receive antenna looks disconnected, and background browser tabs no longer keep the modem working at full speed.

## ✨ New Features

- **Every band in Cell History.** The page now shows each carrier your modem is using, with its band, how often it was the primary one, when it was present, and a signal chart per carrier (RSRP, SINR, RSRQ or RSSI). Pick one carrier to isolate it. Carrier count and total bandwidth have their own chart.
- **Radio detail: modulation, rank and channel quality.** A new section shows download and uplink modulation (MCS), MIMO rank, channel quality (CQI) and transmit power over time. The MCS, rank and congestion readings are off by default, because they ask the modem for extra information; the page says "Reporting off" until they are switched on from the command line (see the Cell History documentation).
- **Congestion.** A new card shows how much of the carrier your device was given while the link was busy, next to your download speed. It only means something while the link is saturated, so quieter periods are drawn faint and dashed rather than as a verdict.
- **Antenna balance.** Cell History plots the four receive antennas for each radio and tells you in words when some are far weaker than the others, for example when a cable has come loose.
- **Antenna warning on the dashboard.** When an antenna reads far below its siblings on the same band, a chip appears in the status area and links to the Antenna Statistics page. It only shows while the problem is real, and it waits for a steady reading so a single odd sample cannot trigger it.
- **7 and 30 day views, and restart markers.** Cell History now offers 7 and 30 day ranges. Every chart marks the moments the router restarted and tells you whether it was a planned reboot, a quick restart or a power loss. Hover any chart and every other chart shows the same moment.
- **Connection Quality full view.** The Connection Quality card on the dashboard has a new expand button. It opens a wide view with latency (including the best and worst of each minute), jitter and packet loss over 1 hour, 6 hours, 24 hours or 7 days. Hover anywhere on the charts to read the exact latency, jitter, loss and probes answered for that minute. Router restarts are marked, and the footer shows typical latency, worst latency, loss and uptime.
- **Connection history survives reboots.** Connection Quality is now recorded once a minute and kept for two weeks, so you can look back at last night even after the router restarted. It keeps recording when the modem cannot be reached, which is also how QManager tells you whether a restart was a power cut or a crash.
- **Hover on the dashboard strips.** Every block on the Connection Quality strips now shows its time span, average latency, jitter and loss when you hover or focus it.

## ✅ Improvements

- **Recording no longer stops when storage fills up.** Cell History could stop recording for good once the router ran low on free space, and never recovered. Old days are now compressed and trimmed first, and recording resumes by itself as soon as space allows. The page tells you when recording is paused or stopped instead of presenting old data as current.
- **Cell History keeps more, in less space.** Rows now record every carrier and are compressed once a day closes, so the archive keeps up to 30 days within a smaller storage budget.
- **A page that tells the truth about gaps.** The history window now always ends at the present moment. If recording stopped, the end of the chart is empty and a notice explains why.
- **Much faster long views.** Day, week and month views are prepared once and reused, so they no longer stall the router while they load. After a reboot the first long view may show only the most recent part while the rest is prepared in the background.
- **Fresher carriers when you are away.** While the dashboard is closed, the history row now refreshes the carrier list once a minute instead of repeating the last values it saw.
- **Background tabs stop polling.** A dashboard left open in a hidden browser tab no longer keeps asking the router for updates, so the modem can drop back to its slower idle polling. It refreshes once the moment you return to the tab.
- **Time zone notice.** If the router's clock is set to a different time zone than your browser, Cell History now says so; times on the page are always shown in your browser's time zone.
- **Cell History panel choices reset once.** The panel picker was rebuilt, so panels return to their defaults the first time you open the new page. Pick the ones you want again; they are remembered per browser.
- **Debug report includes history.** The debug report now lists the history archives, their recorder status and the most recent restarts, to make support easier.
- **More languages covered.** All new text is available in English, Simplified Chinese, Traditional Chinese, Italian and Indonesian.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.36-suncomm5

**System Settings → Software Update.** No migration steps needed. Cell History keeps your existing records and starts adding the new detail about a minute after the update; older records stay readable but do not include the extra carriers. Connection Quality history starts recording from the first minute after the update. The modulation, rank and congestion readings stay off until you enable them.

## 💙 Thank You

Thank you to everyone who reported dropouts and slow nights and helped narrow them down to a band, a cell and an antenna.

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

---

# 🚀 QManager BETA v0.1.35

v0.1.35 adds real-time signal readings on Antenna Alignment and the dashboard, plus one new setting: PCIe power saving for the ethernet port, which now defaults to Performance. Modems that shipped with aggressive power saving on the ethernet controller can see dropouts and extra latency on the LAN port, and QManager now keeps that controller fully awake unless you choose otherwise. The dashboard also gets its Data Used total back, now counted from the modem itself. Tailscale installs can now use iamromulan's smaller Tiny build where the firmware supports it.

## ✨ New Features

- **Install and update QManager from the SDXPINN software feed.** On supported modems you can now add QManager as a regular package with the package manager and keep it current the same way you update your other packages. When QManager is managed this way, the Software Update page says so and points you to the package manager instead of offering its own check and install buttons. The app asks you to reboot once the install finishes. The installer and in-app updates still work as before for installs that did not come from the feed.
- **Real-time signal on Antenna Alignment and the dashboard.** Antenna Alignment now leads with a live signal reading that updates every second, with a 30-second trace and your best position so far, so you can see the effect of each turn as you aim. The dashboard's LTE signal values also refresh every second while you watch them, and both pages quietly fall back to the usual two-second updates if live readings are not available. Live readings only run while the page is open and visible.
- **PCIe power saving for the ethernet port.** The Ethernet Status page's speed card is now **Ethernet Port** and gains a **PCIe power saving** setting: Performance (recommended), Kernel default, Power saving or Max power saving. Changing it never drops the link, and your choice is reapplied on every boot.
- **Performance by default.** New installs and upgrades set PCIe power saving to Performance, since the platform's own default can cause ethernet dropouts and added latency. If you have already picked a setting, it is kept.
- **Video Optimizer works on modems without packet-queue support.** The Traffic Engine page gains an **Engine** choice on the Video Optimizer card. Some firmware builds cannot hand packets to a traffic engine at all, which is why Video Optimizer could be switched on and then do nothing on those modems. They now use a second engine that works by redirecting the connection inside the modem instead, and it is picked automatically. Masquerade still needs the original engine, so on those modems it stays unavailable and says why. Installing this release changes no traffic until you switch a mode on.
- **Choose your Tailscale build.** On modems whose firmware already trusts iamromulan's package feed, the Tailscale install card lets you pick the Official build or the smaller Tiny build, which takes about half the flash space and brings its own service and network setup. Tiny installs, including ones made before this release, can now be updated from the Tailscale page, and your Start on boot choice is kept through every update. To change builds, uninstall and install again.

## ✅ Improvements

- **Every carrier shows in Carrier Aggregation.** Some modems run two carriers together in a single line of their reply, which made QManager show only some of your connected bands (for example one n41 instead of two). All carriers are now listed.
- **Profiles match SIMs that report extra padding.** Some SIMs report their ID with two trailing padding characters (ending in `FF`), which could stop a saved profile from matching its own SIM and skip auto-apply. These SIMs now match.
- **Security hardening.** QManager now refuses every protected request if its sign-in check is damaged or incomplete, instead of only when it is missing. The Traffic Engine download is pinned to a known zapret release and must match its checksum before it installs. The public IP lookup on About Device now verifies the server's certificate.
- **Update errors in your language.** When a check, download or install fails on Software Update, the page now says what went wrong in plain words, in all five languages, instead of showing the English log text and a file path. The full detail is still in the update log.
- **Hardened the modem command service.** Tampered temporary files can no longer stall AT commands or be used to overwrite other files.
- **Data Used is back on the dashboard.** The Device & Speed card shows total download and upload again, and it now counts everything the modem moves, including traffic from devices on your LAN, using the modem's own counter. Older figures could read low because they missed that traffic. If QManager ever has to fall back to a less complete counter, a small hint beside the total says the figure may be low.
- **Data Used no longer has a reset button.** The total simply counts from when QManager was installed.
- **Live LTE SINR on the dashboard.** The LTE signal quality (SINR) on the dashboard now updates every second along with the other LTE values while you watch it.
- **Video Optimizer leaves other traffic alone.** The new engine only splits the start of HTTPS connections, so UDP and QUIC traffic is untouched and nothing is ever blocked to force a connection onto TCP. Turning a mode off removes the redirect straight away, and if the engine ever stops by itself the redirect is removed with it, so browsing cannot be left pointing at nothing.
- **Steadier modem status during scans and SIM switches.** The dashboard keeps showing current LTE signal readings while a network scan or a SIM switch is running, instead of pausing until it finishes.
- **Antenna Alignment fits on one screen.** Receive Chains now sits under Positions beside the live reading, so on a desktop the whole page is visible without scrolling. Record moved up next to the Directional / Omni switch, and each empty position says "Not recorded" right beside its label.
- **A calmer Live Aim card.** The live reading is smaller, with how far you are from your best position right beside it and an "At peak" marker when you are there. The aim score now sits in a single row shaped like your recorded positions, and the trace is drawn in a neutral colour. On a phone, the pinned reading now waits until you scroll past the card instead of covering the page title, and it shows the distance to your peak too. Receive Chains uses one full-width column on a phone and a single row on a 1440px screen.
- **Easier-to-read scan results.** The results summary on Neighbourcell Scan and Full Scan now puts each group's name and cell count on the left and its best signal on the right, with every dBm figure lined up on one edge, so you can compare readings at a glance.
- **Cleaner Tailscale and NetBird install screens.** The big "not installed" panel is gone. Both cards now read top to bottom: a quiet Not installed badge and a refresh button in the header, then your build choice (Tailscale) or the manual shell command (NetBird), then the mobile-data warning right beside the Install button. If an install fails, the error appears above your options and the button changes to Try again. The Tailscale build choice now says plainly what each build costs, and a modem with nothing installed no longer flashes the full installed layout while the page loads.
- **Refresh sits in the same place on both VPN pages.** NetBird's status chip and large Refresh button leave the page header, which now matches Tailscale's. Refresh is a small icon in the card headers, and the connection state is shown once, in the status band.
- **Connection Scenarios work on phones.** On a short screen the New Scenario dialog now fits the display and scrolls its fields, so the band locks and the Create button are always reachable. It also only shows the band fields that apply to the network mode you pick: LTE Only shows the LTE field, 5G SA Only shows the SA field, and Auto or 5G SA / NSA show all three. Hidden band fields are saved empty, so applying the scenario leaves those band locks as they are.

## 📥 Installation

### Fresh Install

```sh
curl -fsSL -o /tmp/qmanager-installer.sh https://raw.githubusercontent.com/dr-dolomite/QManager/development-home/qmanager-installer.sh && sh /tmp/qmanager-installer.sh
```

### Upgrading from v0.1.34

**System Settings → Software Update.** No migration steps needed. The new Performance default takes effect after the next reboot, or right away if you apply it from the Ethernet Port card.

### Install from the SDXPINN software feed

QManager is now also the `sdxpinn-qmanager` package in iamromulan's SDXPINN feed. In LuCI, open **System → Software**, click **Update lists**, then install `sdxpinn-qmanager`, or run:

```sh
opkg update && opkg install sdxpinn-qmanager
```

This works on a fresh modem and over an existing QManager install, and your settings are kept. Reboot when QManager asks you to. Language packs you downloaded need to be installed again afterwards. From then on, update QManager from the same Software page (or `opkg upgrade sdxpinn-qmanager`); the in-app Software Update page will say the install is managed by the package manager. The package can appear in the feed a little later than this release.

## 💙 Thank You

Special thanks to radiomean for supporting the project.

Bug reports and feature requests welcome on [GitHub Issues](https://github.com/dr-dolomite/QManager/issues).

Like what's new? QManager is built and maintained for free — if these updates have made your setup a little better, you can show your support via [Wise](https://wise.com/pay/business/blackcatdev?currency=USD) or [PayPal](https://paypal.me/iamrusss). Every bit helps keep this project alive. [GitHub Sponsors](https://github.com/sponsors/dr-dolomite) works too.
