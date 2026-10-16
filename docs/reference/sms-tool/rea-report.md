# sms_tool (shipped binary) RE report

Binary: dependencies/sms_tool, sha256 eecb50b3335e16ca4ec25479b30d2a0bdf07ff2fccfe566bf232190301926edc, ELF32 ARM EABI5 static, stripped. Analysed with rea-linux (Ghidra 12.1.4) plus arm-linux-gnueabi-objdump (mixed ARM/Thumb-2). Addresses below are virtual addresses in this binary. Main function is the Ghidra "FUN_0005e578" wrapper whose body is inlined at 0x10394-0x1169c (getopt at 0x10394).

## HEADLINE FINDING: the binary is NOT built from current upstream

It is built from upstream obsy/sms_tool at commit 94b66b9 (2026-05-29, "Remove duplicated line"), i.e. the last commit BEFORE the Aug 2026 series (eb055c0 UTF-8 submit, fa434b8 multipart send, 946a16f robust USSD, 966350c `-w` async AT). Evidence: usage string and getopt string are `b:c:d:Ds:f:jRr` (no `w`), message text `sms sent sucessfully: %s` (typo, fixed upstream in eb055c0), `reading port\n` (no strerror), `sms message too long`, `+CUSD:%7[^"]"%[^"]",%d` sscanf, `\u%04X` present (a14e46e fix is in). A reference copy of that upstream revision is at `scratchpad\rea_src\sms_main_94b66b9.c` (clone at `rea_src\sms_tool`, HEAD 866e7d7). A spec written from upstream HEAD will be WRONG for: send (multipart, 30 s alarm, strict ERROR handling), at (`-w`, unbuffered pfi, poll), ussd (accumulating parser), error messages, exit codes. The patch (sms_tool.patch) applies cleanly to 94b66b9 context; it was produced against this older tree.

Spec the shipped binary using `sms_main_94b66b9.c` + patch. I matched the decompilation to that source function by function; the control flow, strings, buffer sizes and constants agree. Details Ghidra could not show (e.g. the exact errno/EOF handling inside stdio) follow glibc semantics.

## 1. AT strings and exact bytes (read from .rodata at 0x5ec84 onwards)

| Addr | Bytes |
|---|---|
| 0x5ec84 | `AT+CMGF=0\r\n` (41 54 2b 43 4d 47 46 3d 30 0d 0a) |
| 0x5ec64 | `AT+CMGS=%d\r\n` |
| 0x5ec74 / 0x5ec7c | `%02X` and `%c\r\n` used with 0x1A: PDU hex then byte 0x1A then `\r\n` (so Ctrl-Z is followed by CR LF in the same line-buffered flush) |
| 0x5ecd4 + 0x5ece0 | `AT+CPMS="` , storage arg, `"\r\n` (three separate fputs, flushed at the LF) |
| 0x5ece4 | `AT+CMGL=4\r\n` (always PDU mode, "all", note: modem auto-marks read) |
| 0x5ee84 | `AT+CMGD=%d\r\n` (single index, no delflag param) |
| 0x5eec8 | `AT+CPMS?\r\n` (10 bytes) |
| 0x5ef38 | `AT+CUSD=1,"%s",15\r\n` (dcs 15 always; arg is PDU-hex unless -R) |
| `at` | arg string verbatim + `\r\n` (fputs, fputs) |
| terminators | `OK` (0x5ec90), `ERROR` (0x5f000), `+CME ERROR` (0x5f008), `+CME ERROR:` (0x5f060), `COMMAND NOT SUPPORT` (0x5f014), `+CMS ERROR:` (0x5ec94), `+CMGS:` (0x5eca0), `+CMGL:` (0x5ecfc), `+CPMS:` , `+CUSD:` |

Not present anywhere: AT+CSCS, any 0x1B (ESC) write, any `> ` prompt wait, any `ATE0`/`AT` probe, any CSMP/CNMI/CSCA. No ESC is ever sent. The only control byte written is 0x1A (send) and, inside the USSD GSM7 PDU, a 0x1d substitution for a trailing 0x00 septet-pad byte (2d75894 behaviour).

stdio details: `pf` (write) is `setvbuf(_IOLBF, NULL, 0)`; `pfi` (read) is default fully-buffered (this build has no `_IONBF` for `at`). Every command ends in `\n` so it is flushed as one write() (the `AT+CPMS="` case is flushed only at its trailing `\r\n`).

## 2. Dispatch and per-command sequence

Arg parsing (0x10394-0x10428): getopt `b:c:d:Ds:f:jRr`. `-w` or any unknown option -> usage() -> prints usage to stderr, exit(2). Subcommand check by strcmp: `send` needs argc>=3, `delete` argc>=2, `at` argc>=2 (else usage, exit 2). Unknown subcommand -> usage, exit 2. For `send`, a message longer than 160 bytes prints `sms message too long: '<msg>'` to stderr (0xa0 compare) but does NOT abort.

Then: `signal(SIGALRM=14, handler 0x11a30)` -> open sequence (section 6) -> `setvbuf`.

### send (phone, text)
1. `pdu_encode(smsc="", phone, text, pdu, 256)` at 0x11ea4. Layout: pdu[0]=0 (no SMSC), first octet `0x11` (SMS-SUBMIT + VPF relative), MR 0x00, DA len = strlen(phone), TOA `0x81` if strlen(phone)<6 else `0x91`, address nibble-swapped, PID 0, DCS 0x00 (GSM 7-bit only), VP `0xB0`, UDL = septets, then 7-bit packed. Text conversion: GSM default table, extension chars via ESC 0x1B (table at 0x65950); UTF-8 2/3-byte leads (0xC0-0xDF, 0xE0-0xEF) become a single `?`; septet count > 160 -> returns -1. No UCS2 submit, no multipart.
2. If encode fails (-1): prints `error encoding to PDU: <num> "<text>` (note the missing closing quote) to stderr and DOES NOT exit; it still computes `AT+CMGS=<garbage>` and goes on to send `AT+CMGF=0`, `AT+CMGS=n`, then the pdu string is just `\x1A\r\n`. Dangerous edge for a reimplementation (do not replicate).
3. Write `AT+CMGF=0\r\n`; read lines until one starts with `OK` (any other line, including ERROR, is ignored; EOF just falls out of the loop and send proceeds anyway). NO alarm is armed yet, so this wait is unbounded.
4. Write `AT+CMGS=<pdu_len-1-pdu[0]>\r\n` (TPDU length excluding the SMSC octet), `sleep(1)` (fixed, does not wait for the `> ` prompt), write `<HEX>\x1A\r\n`.
5. `alarm(5)` armed AFTER the PDU is written (0x10ae2), `errno=0`, read loop:
   - `+CMGS:` -> `printf("sms sent sucessfully: %s", buf+7)` (buf includes the modem's trailing `\r\n`, so stdout is e.g. `sms sent sucessfully: 12\r\n`), then `return 0` immediately WITHOUT consuming the trailing `OK`.
   - `+CMS ERROR:` -> stderr `sms not sent, code: <buf+11>\n` (buf+11 = ` 500\r\n`), loop CONTINUES.
   - `ERROR` -> stderr `sms not sent, command error\n`, loop CONTINUES.
   - `OK` (at 0x10bf6 -> 0x10b26) -> `return 0` silently (success exit with no message!).
   - EOF -> prints `reading port\n` to stderr, falls through every other subcommand test and ends in `exit(0)`.
6. Consequence: failure never returns via the explicit paths. After a CMS/ERROR line the loop keeps reading; if no further line arrives the 5 s SIGALRM fires -> `No response from modem.` exit 2. Hence "send failure = 2" is true only via the timeout (and stderr then contains both the `sms not sent...` line and `No response from modem.`). If a trailing `OK` arrives after an error line, it would exit 0 (a quirk).
7. Quirks: exit status 0 on `OK`-only reply; stale `OK` from a previous run can be taken as the CMGF reply (see section 6).

### recv
`alarm(10)` once (absolute, never rearmed). If `-s` storage given: `AT+CPMS="<storage>"\r\n`, read until line starts with `OK` (ERROR ignored, loop until timeout). `AT+CMGF=0\r\n`, read until `OK`. `AT+CMGL=4\r\n`, then loop: `OK` -> stop; line starting `+CMGL:` -> `sscanf("+CMGL: %d,")` index into `int idx[1024]`, next line = PDU hex (`fgets` buf 1024), decode via pdu_decode (0x1203c), prints human or `-j` JSON. All other lines (+CMTI, +CMT, blank, echo) are silently skipped. Messages count is not bounded by the 1024-entry idx[] -> stack overflow on >1024 messages (practically impossible, storage ~255). Exit via fall-through `exit(0)` even if CMGL returned `+CMS ERROR` (no terminator for ERROR in this loop: it keeps waiting for `OK` until the 10 s alarm -> exit 2). `-r` prints raw PDU hex; JSON has `{"msg":[...]}`.

### delete (idx | all)
No alarm at all. Prints `delete msg from <i> to <j>` (stdout), `all` = 0..49 (hard-coded 50). For each index: write `AT+CMGD=<i>\r\n`; read until `OK` -> `Deleted message <i>`, or `+CMS ERROR:` -> `Error deleting message <i>: <buf+12>` (to STDOUT, not stderr; buf+12 skips the space after the colon). Plain `ERROR` is not recognised (would block forever, no alarm). Always exit 0. Non-numeric idx -> atoi=0 -> deletes index 0.

### status
`alarm(10)`. Optional `AT+CPMS="<storage>"` wait OK. Write `AT+CPMS?\r\n`; loop: `+CPMS:` line -> `sscanf("+CPMS: \"%2s\",%d,%d,")`; ok -> `Storage type: <ME|SM|..>, used: N, total: M` (stdout); fail -> `unparsable CPMS response` (stderr); then break. `OK` -> break. Only the FIRST memory (mem1, read storage) is reported; `%2s` truncates names to 2 chars. exit 0.

### ussd
Builds `AT+CUSD=1,"<hex-GSM7-pdu or raw>",15\r\n` (buffer cmdstr[100] -> overflow-prone for long codes without -R... the snprintf is bounded, so it truncates), writes it, `alarm(10)`. Loop on lines: `OK` skipped; `+CME ERROR:` -> stderr `error: <buf+12>`, break; `+CUSD:` -> `sscanf("+CUSD:%7[^\"]\"%[^\"]\",%d")` (needs the whole `+CUSD: n,"text",dcs` on ONE line; ussd_buf is 320 bytes -> overflow on a longer payload). rc==2 (no dcs) is accepted only with -r (multiline mode). Decode by DCS: coding via `(dcs&0xf0)>>4` table; known upstream bug preserved: group 0xF is never treated as 7-bit because `lower & 0x4 == 0` is always false, so DCS 0x0F without `-c 0` prints `unknown coding scheme: 15` (stderr). `-c 0/2` overrides. After output: break, exit(0). Timeout -> exit 2.

### at "<cmd>"
`alarm(5)` (absolute 5 s for the whole command). Writes cmd + `\r\n`. Loop: `OK` -> exit(0) (prints "OK" only with -D); `ERROR`, `COMMAND NOT SUPPORT`, `+CME ERROR` (no colon needed, prefix match) -> exit(1) (line printed to stdout only with -D, so the error text is LOST without -D); everything else, including the echoed command line and URCs, is printed to stdout verbatim (with the modem's `\r\n`). `+CMS ERROR` is NOT a terminator -> waits for alarm -> exit 2. EOF -> falls to exit(0).

## 3. Timeouts

- `signal(SIGALRM, h)` where h (0x11a30) does `fwrite("No response from modem.\n", stderr)` then `exit(2)`. exit() runs the atexit handler (close(port)).
- Alarm implemented as setitimer syscall wrapper (0x27bf8), seconds: send 5 (armed late, after PDU), recv 10, status 10, ussd 10 (armed after command is written), at 5. delete: none. Initial `AT+CMGF=0` wait in send: none. No select/poll anywhere in this build (poll only exists in upstream HEAD for `-w`).
- Reads: `fgets` (0x18a9c, 1024-byte buffer, line oriented) on a stdio FILE over the blocking fd (second open has no O_NONBLOCK). A read that returns partial lines is reassembled by stdio. fgets is interrupted by SIGALRM (handler exits, no SA_RESTART issue).
- Timeout -> stderr `No response from modem.` , exit status 2.

## 4. Patch presence (verified)

- Default device string `/dev/smd11` at 0x5f090; usage text says `(default: /dev/smd11)`.
- `isatty()` (0x28bc4, tcgetattr == 0 test) guards the whole setserial body (tcgetattr/cfmakeraw/cfset*speed/tcsetattr skipped when not a TTY) and the exit-time reset: resetserial (0x11a90) does `isatty(port)` -> if false only `close(port)`; if true `tcsetattr(TCSANOW, save_tio)` + `tcflush(TCIOFLUSH)` + close.
- exit(1) paths: first open fail -> (if -D `open(%s)\n`) then `open port failed\n` then exit(1); reopen fail -> (if -D `reopen(%s)\n`) `open port failed\n`, exit(1); fdopen fail -> `open port failed\n`, exit(1). Seen at 0x1066x/0x10a-0x10cxx via `FUN_000135dc(1)` (= exit).
- Differences from the patch header text: none; patch matches binary. Differences from upstream HEAD: see headline finding.

## 5. Exit codes

| Situation | Exit |
|---|---|
| open / reopen / fdopen fail (patched) | 1, stderr `open port failed` |
| usage / bad args / unknown subcommand / unknown option (incl. `-w`) | 2 |
| SIGALRM timeout (stderr `No response from modem.`) | 2 |
| send: `+CMGS` | 0 |
| send: bare `OK` | 0 (silent) |
| send: `+CMS ERROR`/`ERROR` | message on stderr then, in practice, 2 via alarm (5 s) |
| send: EOF on read | 0 after `reading port` on stderr |
| recv/status/delete/ussd normal completion and error-handled paths | 0 |
| ussd `+CME ERROR` / unparsable | 0 (message to stderr, then break -> exit(0)) |
| at: OK | 0 |
| at: ERROR / COMMAND NOT SUPPORT / +CME ERROR* | 1 |
| at: EOF | 0 |
| send `error encoding to PDU` | continues, no exit |

(The repo's belief "send failure = 2, open failure = 1" is right but send's 2 is purely the 5 s alarm; a quick failure exit does not exist.)

## 6. Risks for a reimplementation

- Open trick: opens `dev` O_RDWR|O_NONBLOCK|O_NOCTTY (0x902), runs setserial (no-op, not a TTY), registers atexit(resetserial), CLOSES it, then reopens O_RDWR|O_NOCTTY blocking (0x102). The device is therefore opened, closed and reopened back to back on every invocation, and closed again at exit. The device is never held between invocations; each CLI call = one open session. No flock/lock files are taken: serialising against other AT users of /dev/smd11 (qmanager_atd, atcli) is entirely the caller's job.
- Two FILE* (pf "w", pfi "r") share one fd; exit order: atexit resetserial closes fd BEFORE stdio flushes/closes the FILEs (harmless because pf is line-buffered and every command ends with LF).
- No input flush before the first command and no echo handling: stale bytes already queued on the node (e.g. the `OK` left behind after `send` returned at `+CMGS`, URCs such as `+CMTI`) can be consumed as the reply to the next first wait loop. Unsolicited lines are "drained" only implicitly: every loop discards non-matching lines until its terminator; nothing reads after the terminator, so URCs arriving afterwards are left in the kernel buffer for the next opener/reader. `at` prints unknown lines (including URCs and the echoed command) to stdout; others swallow them.
- `+CMGL` output depends on `\r\n` line endings: lines retain `\r\n`, hex decode loop tolerates the trailing CR/LF only because char_to_hex returns -1 and the length used is strlen(buf) (includes \r\n -> l/2 may include a junk byte; pdu_decode copes). `-r` raw prints buf with CRLF.
- Fixed buffers: line buf 1024; `idx[1024]` ints; pdu[256]; pdustr 2*256+4; `cmdstr[100]` (AT+CUSD with PDU or -R text truncates/may break long USSD codes); `ussd_buf[320]` (sscanf `%[^"]` unbounded -> overflow for payload > 319); `ussd_txt[800]`; `sms_txt[322]`, `phone_str[40]` in recv; mem1[9] for `%2s`.
- `AT+CMGL=4` returns ALL messages and flags unread as read (modem side effect); storage selection happens only with `-s`; `status` reports only the first storage triplet.
- delete: `all` hard-coded 0..49 and hard-coded no-timeout; `+CMS ERROR` text printed on stdout.
- Timeout semantics are absolute per process, not idle-based; the send handshake has an unbounded first wait and a fixed 1 s `sleep` between CMGS and the PDU (no prompt wait), so on a slow modem the PDU can race the `> ` prompt.
- Messages: success string has the typo `sucessfully`; modem CRLF is preserved in outputs, so parsers must strip `\r`.
- Upstream HEAD features (`-w`, UTF-8/UCS2 submit, multipart send, `+CUSD` split-line accumulation, `AT` unbuffered read, 30 s send alarm, explicit `return 1` on errors) do NOT exist in this binary.
