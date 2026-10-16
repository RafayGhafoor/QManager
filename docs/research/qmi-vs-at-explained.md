# Is there a faster way to read the modem? (Plain-language summary)

**Date:** 2026-10-16. **Device:** the RM551E test modem. **The detailed version** is [`qmi-vs-at.md`](qmi-vs-at.md), which has the measurements, addresses and evidence.

## The question we started with

QManager shows live signal data: signal strength per antenna, which cells you're connected to, carrier aggregation and so on. It gets all of it by sending **AT commands** to the modem, such as `AT+QENG` and `AT+QRSRP`.

AT commands travel down a single channel, `/dev/smd11`. Only one command can use it at a time, so everything else waits in line. The idea was this:

> *Are AT commands just a wrapper around some "real" data source we could read directly, skipping the queue and making the UI faster?*

## The short answer

**Partly yes, mostly no, and the real slowness turned out to be a bug in our own code, which is now fixed.**

## What we found, step by step

### 1. The modem has two ways in: AT and QMI

Think of the modem's radio chip as a **library** and the data as **books** inside it.

- **AT commands** are like asking the librarian at a front desk that has **one line**. You write your request on a slip, wait your turn, and get a typed answer back.
- **QMI** is the library's **staff entrance**. It's the native, binary language Qualcomm chips speak internally. Many programs can use it **at the same time**, with no line.

The modem's own system programs (network manager, connection manager and so on) already use QMI all day. So the staff entrance exists and it is fast. We measured about **0.2 to 1 millisecond** per request.

**The catch:** the staff entrance doesn't hand out every book. With QMI we can get the basics (which LTE cell you're on, overall signal strength, registration status), but **not** the detailed items QManager shows most:

- signal **per antenna** (the 4-antenna view);
- the list of **carrier-aggregation** cells on 5G;
- **MIMO layers** and **timing advance**;
- the 5G cell ID and band while in NSA mode.

On this firmware those details are **only** available through AT commands. The modem's AT engine computes them itself and doesn't expose them over standard QMI.

### 2. The real slowness was our own bug, not the modem

When we timed things carefully, the AT command itself took about **5 to 8 milliseconds**. That's fast. Yet each call through QManager's `qcmd` wrapper took about **1 second**.

**Why:** `qcmd` holds a lock (a "do not disturb" sign) while it talks to the modem, so two callers never collide. It also runs the command under a safety timer, `timeout`. That timer quietly kept a copy of the lock and held it for about a second **after** the command had already finished. Every caller after it had to wait for nothing.

**Fix:** a tiny change that stops the timer from keeping the lock (the `9>&-` in `qcmd`). It shipped and was checked on the real modem: about **1 second → about 50 milliseconds** per call. This one-line fix removed most of the waiting in line.

### 3. Do Quectel's own programs keep a hidden copy of the data?

Even with no other public door, we thought the modem maker (Quectel) might run a background program that already collects the data and leaves it somewhere we could read: a file, a socket or a system message bus.

To check, we **decompiled** their programs. Decompiling turns the compiled machine code back into readable C-like code, so you can see what a program does without its source. The tool was **REA**, driving **Ghidra** (a free reverse-engineering suite), running inside WSL (Linux on Windows). We looked at three pieces:

| Program | What it actually does | Has radio data for us? |
|---|---|---|
| `libql_atcop.so` | Handles about 70 Quectel-specific AT commands on the Linux side, mostly GPS, settings and temperature. `AT+QTEMP` just reads the same temperature files QManager already reads. | No. The signal commands aren't handled here; the radio chip answers them itself. |
| `quectel_daemon` | Housekeeping: syncs version numbers, relays a few status flags, and passes AT text back and forth over QMI. **It isn't even running on our modem.** | No. |
| `ql_nw_service` | Manages the internet connection: connect, disconnect, attach, detach, IP passthrough. | No. It never asks for signal data. |

We also read Quectel's **private QMI "menu"**, its vendor service, which lists 76 request types. The ones we could identify cover GPS, sleep mode, a flash-memory test, debug security and version sync. In other words, it's a **control panel, not a dashboard**.

On the live modem we found no shared file, socket or system-bus entry holding radio measurements.

### 4. One loose end

Three entries on Quectel's private menu (numbers 0x4C, 0x4D and 0x4E) return large chunks of data, and **nothing on the modem ever uses them**. They *could* be radio data, or something else entirely.

Because we don't know what they do, sending one is a small risk: it might *do* something rather than just *read* something. So we have **not** tried them. This is the only open lead that could change the conclusion, and testing it needs your explicit OK.

## So, should we build a new tool?

**Not a QMI tool for the expensive data. It can't get it.** If we build anything, it should be **in Rust** (your preference), as one small self-contained program. In order of usefulness:

1. **An "AT broker"**: one long-running program that owns the AT channel and hands out answers. It removes the remaining per-call overhead of starting several small programs for each command, while keeping **every** field QManager shows today. **Only worth building if things still feel slow** now that the lock bug is fixed.
2. **(Optional) A QMI listener** that gets notified when the basic signal or cell changes, so the dashboard updates instantly for those fields. It wouldn't replace any AT command, so it's a nice-to-have.
3. **(Optional, needs your OK) A one-time test** of those three mystery menu entries, to close the last open question.

## What changed in the project

- **The `qcmd` lock fix** (`c2ae24a8`) is on `development-home`. Nothing has been pushed.
- **This research and the detailed report** are on branch `claude/vibrant-einstein-1a3227`, not merged.
- **No modem settings were changed.** Everything on the modem in this round was read-only.

## Glossary

| Term | Meaning |
|---|---|
| **AT command** | A text command sent to the modem, such as `AT+QENG`. Old, simple, one at a time. |
| **smd11** | The single internal channel QManager uses to send AT commands. |
| **QMI** | Qualcomm's native binary protocol between Linux and the radio chip. Fast and multi-user. |
| **QRTR** | The internal "phone network" QMI messages travel on inside the chip. |
| **NAS** | The QMI service for network and signal information. |
| **Vendor service** | Quectel's own private QMI menu (service 0xE3), separate from Qualcomm's standard ones. |
| **Lock** | A "do not disturb" sign so two programs don't talk on the AT channel at once. |
| **Decompile** | Turn a compiled program back into readable code to see what it does. |
| **Ghidra / REA** | The decompiler (Ghidra) and the assistant toolkit that drives it (REA). |
| **Carrier aggregation (CA)** | Combining several cell frequencies at once for more speed. |
| **MIMO** | Using multiple antennas at once. "Layers" = how many parallel streams. |
| **Timing advance (TA)** | A rough measure of your distance from the tower. |
