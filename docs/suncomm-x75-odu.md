# Suncomm X75 ODU (MT7981 + RM551E-GL over MHI)

A router-based ODU that carries the same `RM551E-GL` module QManager already
targets, but **not** on the barebone modem firmware layout. Four assumptions
baked into the original target do not hold, and each has a supported answer.

**Status:** backend verified on hardware 2026-10-18 (AT stack, polling, SMS
transport, `/www` left intact). See [Validation](#validation).

## Device profile

| | |
|---|---|
| Board | `ZX7981POEQ` (MediaTek MT7981, `aarch64_cortex-a53`, 2 cores) |
| Modem | `Quectel RM551E-GL`, `RM551EGL00AAR02A02M8G` |
| Modem transport | **PCIe / MHI** (`17cb:0309`), `rmnet_mhi0.1` for data |
| AT channel | **`/dev/mhi_DUN`** — there is no `/dev/smd11` |
| OS | OpenWrt 21.02-SNAPSHOT, kernel 5.4.270, `DISTRIB_TAINT='no-all busybox'` |
| BusyBox | v1.33.2 — **no** `FEATURE_FANCY_SLEEP`, no `timeout` applet |
| Web root | `/www` is the **stock OEM UI** (`WTAG`); LuCI also present |
| Feed | 21.02-SNAPSHOT, only 369 packages — no `websocat`/`ethtool` |

## What differs, and the answer

### 1. AT lives on `/dev/mhi_DUN`, not `/dev/smd11`

`qm_at_device()` in [`platform.sh`](../scripts/usr/lib/qmanager/platform.sh)
resolves the AT device at runtime. Resolution order (first hit wins):

1. `$QM_AT_DEVICE` — per-invocation override
2. `uci quecmanager.at.device`
3. `/etc/qmanager/atdev` — one-line drop-in file
4. first existing of `/dev/smd11`, `/dev/mhi_DUN`, `/dev/ttyUSB2`, `/dev/ttyUSB3`
5. `/dev/smd11` (historical default)

Because `/dev/smd11` is tried first, every existing deployment behaves exactly
as before; this device falls through to `/dev/mhi_DUN` with no configuration.
To pin it explicitly:

```sh
uci set quecmanager.at.device='/dev/mhi_DUN'
uci commit quecmanager
```

Consumers pass the device explicitly (`atcli_smd11 -p "$dev"`,
`sms_tool -d "$dev"`), so a wrong value is a visible error, never a hang.

**The legacy engine is required on MHI.** The Rust AT broker
(`native/qmanager_atd`) still compiles `/dev/smd11` in as `const SMD_PATH`, so
on this device select the shell gatekeeper:

```sh
uci set quecmanager.at.engine='legacy'
uci commit quecmanager
/etc/init.d/qmanager_atd restart
```

Making the broker configurable is tracked as follow-up work; until then the
broker path will not reach an MHI modem.

*Alternative without the engine switch:* create the compatibility symlink
`ln -sf /dev/mhi_DUN /dev/smd11` at boot. This works — the broker, `sms_tool`
and `atcli_smd11` all follow it — but it hides the mismatch instead of
resolving it, and needs its own init script named **outside** the
`/etc/init.d/qmanager*` namespace (the installer prunes unrecognised
`qmanager*` init scripts).

### 2. `/www` is the stock OEM UI

Upstream installs the frontend to `/www` and wipes `/www/*` on every install.
On this device that destroys the vendor UI. Install elsewhere instead:

```sh
sh install.sh --web-root /opt/qmanager/www --no-reboot
```

`--web-root DIR` (absolute) sets both the frontend root and the CGI tree
(`DIR/cgi-bin/quecmanager`), creates `DIR` if needed, and records the choice in
`/etc/qmanager/web_root` so `uninstall.sh` cleans the same tree. The wipe then
only ever touches `DIR`. Serve it with a second uhttpd instance:

```sh
uci set uhttpd.qmanager=uhttpd
uci set uhttpd.qmanager.home='/opt/qmanager/www'
uci set uhttpd.qmanager.listen_http='0.0.0.0:8080'
uci set uhttpd.qmanager.cgi_prefix='/cgi-bin'
uci set uhttpd.qmanager.rfc1918_filter=1
uci commit uhttpd
/etc/init.d/uhttpd restart
```

`uhttpd` resolves `cgi_prefix` under `home`, so `/cgi-bin/quecmanager/...`
resolves against `/opt/qmanager/www` while the stock UI and LuCI stay on `:80`.
The frontend derives its host from `window.location.hostname`, so it works on
any port unchanged; its cookies (`qm_session`, `qm_logged_in`) do not collide
with LuCI's `sysauth_*`.

### 3. Fractional `sleep` is unavailable

`qcmd.sh`'s flock retry grain is `sleep 0.1`. This BusyBox rejects fractional
arguments, and a failing `sleep` returns *immediately* — turning the retry loop
into a busy spin and collapsing the lock-wait window. `qm_sleep_frac()`
(`platform.sh`) tries native support, then `usleep` (which BusyBox provides even
without `FEATURE_FANCY_SLEEP`), then rounds up to 1s.

### 4. `websocat` is not packaged

If the bandwidth WebSocket is wanted, `websocat` must be supplied out-of-band —
the static `websocat.aarch64-unknown-linux-musl` release build runs as-is. It is
not in any OpenWrt release feed for `aarch64_cortex-a53`. `ethtool` and
`coreutils-timeout` come from any 21.02.x release archive; `.ipk` files are `ar`
archives, so extract them on a host and copy the binary across.

## Validation

```sh
cat /dev/smd11 >/dev/null 2>&1            # present only if you added the shim
uci get quecmanager.at.device             # /dev/mhi_DUN (or unset → autodetect)
cat /tmp/qmanager_status.json | head      # poller output: service_status, type
ls -la /www/index.html                    # still the OEM UI, not QManager
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/
```

Confirmed on hardware:

- `qcmd ATI` → `Quectel / RM551E-GL / Revision: RM551EGL00AAR02A02M8G / OK`
- poller reporting `5G-NSA`, `service_status: optimal`, WAN up
- `/www` byte-identical before/after install (217 entries, OEM markers intact)
- both `:80` (OEM UI + LuCI) and `:8080` (QManager) serving

## Known limitations

- **Rust broker hardcodes `/dev/smd11`** — use `quecmanager.at.engine=legacy`
  on this device (above). The broker does not honour `quecmanager.at.device`.
- **The built-in OTA updater re-runs the stock `install.sh`**, which resets the
  web root to `/www` and wipes it. After an in-app update, re-run the installer
  with `--web-root`. On this device the OEM files survive in the read-only
  `/rom/www`, so clearing `/overlay/upper/www` un-hides them again.
- **The vendor `lteat` daemon shares the AT channel.** QManager's `flock`
  serialises its own callers but cannot coordinate with the vendor process, so
  occasional interleaved responses on `/dev/mhi_DUN` are possible.
- **`msmtp` needs `libgnutls`**, which is absent from this feed — email alerts
  only. SMS alerts are unaffected.
