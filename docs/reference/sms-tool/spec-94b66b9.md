# sms_tool behavioural spec (shipped build = obsy/sms_tool 94b66b9 + QManager patch)

Provenance: upstream HEAD is 866e7d72d2b7a788ded6c4e4772f4d5f5c55eac9 (2026-08-15). The shipped binary (dependencies/sms_tool, built May 31) matches **94b66b9** (2026-05-29): its strings contain "sms sent sucessfully", "sms message too long", no `-w`, no multipart. `dependencies/sms_tool.patch` applies cleanly to 94b66b9 (verified with git apply --check) but NOT to HEAD (open-error context differs). This spec describes 94b66b9+patch. Refs: `M:n` = sms_main.c line, `P:n` = pdu_lib/pdu.c line in the 94b66b9 tree (scratchpad/src/v94b). Section 9 lists HEAD additions. All behaviours were cross-checked with a Python port (scratchpad/port.py, vectors.py); the C was never built or run.

## 1. CLI
`sms_tool [opts] <cmd> [args]`; getopt string `"b:c:d:Ds:f:jRr"` (M:173). Options are parsed BEFORE the subcommand.
- `-b N` baud (atoi; irrelevant, termios is skipped on non-TTY). `-c N` USSD coding override (0=7bit, 2=UCS2). `-d DEV` (patched default `/dev/smd11`). `-D` debug (USSD/at echo; open() traces). `-s STORAGE` (recv/status only: issues `AT+CPMS="<s>"`). `-f FMT` strftime format, default `"%D %T"` (= `MM/DD/YY HH:MM:SS`). `-j` JSON (recv). `-R` raw USSD input. `-r` raw output (USSD, recv).
- Subcommands: `send <num> <text>` (argc>=3), `recv`, `delete <idx|all>` (argc>=2), `status`, `ussd [code]`, `at <cmd>` (argc>=2). Anything else/short: usage on stderr, **exit 2** (M:21-42, 191-214).
- `send` with text >160 bytes prints "sms message too long" to stderr but continues (M:197).
- Exit codes: usage 2; SIGALRM timeout 2 ("No response from modem." stderr, M:116); patched open/reopen/fdopen failure 1 ("open port failed"); success 0; `at`: OK->0, ERROR / COMMAND NOT SUPPORT / +CME ERROR ->1. The tool falls through to `exit(0)` at the end (M:751), so EOF, USSD errors, recv/status errors that terminate the loop all exit 0.
- The `-s` flag has NO effect on `send` or `delete`. delete acts on whatever mem1 the modem currently has selected (sms.sh relies on the preceding `recv -s SM` leaving mem1=SM and re-asserts ME with `at 'AT+CPMS="ME","ME","ME"'`).

## 2. Port handling (M:216-242)
1. `signal(SIGALRM, timeout)`; timeout handler prints message, `exit(2)` (flushes stdout, so a partial `{"msg":[` can already be on stdout).
2. `open(dev, O_RDWR|O_NONBLOCK|O_NOCTTY)`; fail -> exit 1. `setserial()` returns immediately if `!isatty` (patch). `atexit(resetserial)` (closes fd; tcsetattr skipped on non-TTY).
3. `close(port)`; reopen `open(dev, O_RDWR|O_NOCTTY)` (blocking!). fail -> exit 1.
4. Two stdio streams on one fd: `pf = fdopen(fd,"w")`, `pfi = fdopen(fd,"r")`; `setvbuf(pf,NULL,_IOLBF,0)`. Read stream is default-buffered (fgets on a blocking fd).
- **Write framing**: stdout line-buffered => each command reaches the device as ONE write() of the full line including trailing `\r\n` (pieces like `AT+CPMS="` + storage + `"\r\n` are coalesced). Send the PDU line as one write too.
- **Read model**: blocking `fgets` (1023-byte lines). A line is classified purely by `starts_with(prefix)` (no trimming; lines still carry `\r\n`). Echoed commands, blank lines and `> ` prompt lines are just non-matching lines. The `> ` prompt has no newline of its own but is followed by the modem's leading `\r\n` of the result, so it lands at the start of a line `"> \r\n"`... (a prompt+result on the same line would defeat `starts_with("+CMGS:")`; a reimplementation should search for lines, not rely on this).
- **Timeouts** (alarm, seconds, whole-subcommand, never re-armed): recv 10 (armed before first write); status 10; ussd 10 (after write); at 5; send 5 but armed only AFTER the PDU is written; the `AT+CMGF=0` wait in send and ALL of `delete` have NO alarm (can hang forever on a plain `ERROR`).
- Terminators: recv stops at the first line starting `OK`; there is no handling of `ERROR`/`+CMS ERROR` in recv/status/CPMS-wait loops, so these run to the alarm: stderr "No response from modem.", exit 2.

## 3. send (M:245-289)
Order: encode PDU (no alarm), then
1. write `AT+CMGF=0\r\n`; read lines until one starts `OK` (EOF just proceeds).
2. write `AT+CMGS=<n>\r\n` where `n = pdu_len - 1 - pdu[0]` (pdu[0]=SCA length byte, always 0 => n = pdu_len-1).
3. `sleep(1)` (does NOT wait for `> `).
4. write `<PDU hex UPPERCASE>` + byte `0x1A` + `\r\n` (note the CR LF after Ctrl-Z). No ESC/cancel is ever sent.
5. `alarm(5)`; loop lines: `+CMGS:` -> stdout `sms sent sucessfully: <rest after 7 chars incl \r\n>` and **return 0**; `+CMS ERROR:` -> stderr `sms not sent, code: <buf+11>` (loop CONTINUES); `ERROR` -> stderr `sms not sent, command error` (loop continues); line `OK` -> return 0 (no message); EOF -> stderr "reading port", falls to exit 0.
Consequence: a real send failure prints the message then blocks until the 5 s alarm => "No response from modem." and **exit 2**. That is the only way to see rc 2 for a failed send; exit 1 is only open failure; success 0.
Encode failure (`pdu_len<0`) only prints "error encoding to PDU" and then CONTINUES with garbage (no return) (M:247-262). Don't copy.

### PDU encode (P:280-346)
Bytes: `00` (SCA len 0 = SMSC from modem), `11` (SMS-SUBMIT, VPF=relative; no UDHI/SRR/RD), `00` (MR), DA length = **strlen(number)** (chars, so a leading `+` counts), TOA = `0x81` if strlen<6 else `0x91` (always international for >=6 digits even for local numbers; sms.sh strips a leading `+` before calling), DA digits as swapped nibbles with `F` filler on odd count, `00` PID, `00` DCS (GSM7 only), `B0` VP (relative 10 days), UDL = septet count (ESC pairs count 2), packed 7-bit UD.
- Digit validation is broken (`<'0' && >'9'`, P:250): non-digits (e.g. `+`) become garbage nibbles (`+` -> nibble 0xB, count includes it). Reimplement: reject/normalise.
- Text->GSM7 (P:191-234): operates on UTF-8 BYTES with a Latin-1 table. ASCII maps to the GSM default alphabet: `@`=00, `$`=02, `_`=11, `\n`=0A, `\r`=0D; `[ \ ] ^ { | } ~ FF` -> ESC(1B)+`3C 2F 3E 14 28 40 29 3D 0A`; `` ` `` DEL and other controls -> `?`. Any 2-byte UTF-8 lead (C0-DF) or 3-byte lead (E0-EF) -> a single `?` (continuation consumed); 4-byte leads -> `?` per byte (continuations can wrongly map, e.g. A3->`£`). So `é`, `€`, emoji all become `?` (lossy; no UCS2).
- Limit: >160 septets -> encode error (see above). `sms_text_7bit[320]` is unchecked before the limit test (stack overflow for very long input).
- Packing (P:60-86) matches standard 7-bit packing EXCEPT: when septet count is a multiple of 8 (8,16,...,160) or zero it appends one extra trailing octet (`(t[n]&0x7f)>>0`, reading uninitialised `t[n]`), making n and the PDU one byte too long (UDL stays correct). A full 160-char message hits this. A correct reimplementation must emit exactly ceil(7*UDL/8) octets.

## 4. recv (M:291-458)
Sequence (single alarm(10)): [if `-s S`: write `AT+CPMS="S"\r\n`, wait line `OK`], write `AT+CMGF=0\r\n`, wait `OK`, write `AT+CMGL=4\r\n` (4 = ALL: read, unread, sent, unsent). Then loop lines until `OK`: for a line starting `+CMGL:` -> `sscanf("+CMGL: %d,")` index (fail: stderr "unparsable CMGL response", skipped); the `<stat>` field is NOT parsed or output; the NEXT line is taken as the PDU hex (assumes no blank line between). Max 1024 messages (`idx[1024]`).
- **Hex parse bug**: the PDU line still contains `\r\n`; the loop runs over strlen incl. CR/LF so the PDU buffer gets one extra junk byte (0xEF) and pdu_len = bytes+1 (harmless for consistent PDUs). Use exact hex length in a reimplementation. Non-hex chars -> -1 garbage (no validation).
### Output
Text mode per message: `MSG: <idx>\n`, `From: <sender>\n`, `Date/Time: <fmt>\n`, then only if concat: `Reference number: <ref>\n` `SMS segment <part> of <total>\n`, then content bytes, then `\n\n`.
JSON mode (`-j`): stdout `{"msg":[` + objects joined by `,` + `]}\n`. Object key order is fixed: `{"index":N,"sender":"S","timestamp":"T",` [`"reference":R,"part":P,"total":T,`] `"content":"C"}`. Empty inbox => `{"msg":[]}`. Decode failure (sms_len<=0): stderr "error decoding pdu N: <hex>" and object becomes `{"index":N,"error":"error decoding pdu","sender":"","timestamp":"","content":""}`.
- Not escaped: `sender` and `timestamp` are printed raw (an alphanumeric sender containing `"` or `\` breaks JSON; Latin-1/Greek bytes from a sender are raw non-UTF-8 or UTF-8 mix).
- `-r`: text prints the hex line (with `\r\n`) + `\n`; with `-j -r` it emits `"content":"<hex>\r\n"` and never closes the object (invalid JSON). Don't copy.
- Content JSON escaping (print_json_escape_char M:144-161): `"`->`\"`, `\`->`\\`, `/`->`\/`, \b \n \f \r \t as short escapes, other <0x20 and >0x7E bytes -> `\u00xx` (lowercase hex); UCS2 units with high byte !=0 -> `\uxxxx` lowercase; Greek via GSM7 path -> `\uXXXX` UPPERCASE (`%04X`). Surrogates pass through as separate `😀` escapes (valid JSON). Text mode content is raw bytes: GSM7 -> Latin-1 single bytes (invalid UTF-8 for é etc.) and UTF-8 for Greek; UCS2 -> UTF-8 (surrogates produce NOTHING, emoji dropped; U+FFFF dropped).

### PDU decode (P:348-447), treated as an SMS-DELIVER always
- `s = 1 + pdu[0]` (SCA length incl. TOA; SCA content ignored). Fail if `s+1 > len` (-2).
- First octet `f=pdu[s]`. **TP-MTI is never checked.** UDHI = bit 0x40 only (`(f>>4)&4`). MMS/SRI/etc ignored. SUBMIT/STATUS-REPORT entries from CMGL=4 are mis-parsed as DELIVER and yield garbage (empty sender, nonsense date, empty content; see V11). A reimplementation should check MTI (f&3): 0=DELIVER; 1=SUBMIT, 2=STATUS-REPORT should be skipped/handled explicitly.
- OA: `L=pdu[s+1]` (digit/semi-octet count; `L+1 > 40` -> -3), `TOA=pdu[s+2]`. If TOA == **0xD0 exactly** => alphanumeric: decode ceil(L/2) bytes as 7-bit septets requesting L septets, then drop the final septet if it is 0 (pad/'@'), then map via GSM table (incl. ESC extension). Else numeric: each of L nibbles -> `'0'+nibble` (lo nibble first); **no `+` is ever added** for 0x91, TOA otherwise ignored; nibbles A-F become `: ; < = > ?`.
- `pid = s+3+(L+1)/2`. PID byte ignored. `dcs = pdu[pid+1]`. SCTS = pdu[pid+2..+8]: BCD swapped digits `x/16 + (x%16)*10`; year=2000+yy, mon, day, h, m, s; **timezone octet ignored**; treated as UTC (`timegm`) and re-printed via `gmtime`+`strftime(fmt)` => the sender-local time as sent, default `MM/DD/YY HH:MM:SS` (e.g. `08/26/02 19:37:41`). Invalid BCD is normalised by timegm. 32-bit time_t on armhf (>=2038 fails).
- `st = pid+9`; need `st+1 <= len` else -1. `UDL = pdu[st]`; `UDL > 322` -> -1.
- UDH: if UDHI: `tmp = pdu[st+1] + 1` (UDHL+1 bytes) ; `skip=tmp`; `ref=pdu[st+tmp-2]`, `total=pdu[st+tmp-1]`, `part=pdu[st+tmp]` i.e. the LAST THREE BYTES of the header are assumed to be the concat IE data. IEI is never inspected. 8-bit concat (IEI 00, ref 1 byte) works; 16-bit (IEI 08) reports only the LOW byte of the 16-bit ref; any other trailing IE (ports, etc.) is misread as concat; a concat IE not last is misread; no bounds checks. concat fields are printed iff `total > 0`. No reassembly: each part is its own entry; consumers group by sender+ref(+storage), as sms.sh does.
- DCS switch `(dcs/4)%4`: 0 -> GSM7; 2 -> UCS2; 1 (8-bit) and 3 -> content empty (result "ok" with empty content). Therefore group codings are only approximately right: 0xF0 ->7bit, 0xF4 -> 8-bit(empty), 0xE0-0xE3 (MWI UCS2) wrongly 7-bit, class/compression bits ignored.
- GSM7: UD bits decoded from bit 0 of UD *including* the UDH bytes, UDL septets total (UDL counts header septets); fill bits are therefore implicit. Text starts at septet `H=(skip*8+6)/7` (=ceil(skip*8/7); 7 for 6-byte UDH, 8 for 7-byte UDH). Mapping: GSM default table to Latin-1 bytes (`£`=A3 etc.); 0x10,0x12-0x1A Greek -> 2-byte UTF-8 (0x11 is `_`); ESC (1B) + next: only `0A`->FF, `14`->^, `28`->{, `29`->}, `2F`->\, `3C`->[, `3D`->~, `3E`->], `40`->| ; **`1B 65` (euro) is NOT in the table and is silently DROPPED**, as is any unknown escape. Output length is clamped to UDL (`out_pos > UDL` -> UDL), so Greek (2 bytes per septet) truncates the TAIL of the message (V10: "ΔΣ" -> "Δ"). The converter starts at index `skip` (bytes) not `H`; harmless unless the header septet at [skip,H) decodes to 0x10-0x1A/0x1B (part number >= 64 for 8-bit UDH) => a stray leading byte (V8).
- UCS2: content = UTF-16BE from byte `skip` (bytes) for UDL octets; no odd-length guard.
- Septet decoder (P:90-120) is correct for consistent PDUs; for UDL==0 returns error (-1, entry shows as decode error).

## 5. status (M:489-521)
alarm(10); [if `-s S`: `AT+CPMS="S"\r\n`, wait `OK`]; write `AT+CPMS?\r\n`; on line `+CPMS:` do `sscanf("+CPMS: \"%2s\",%d,%d,")` and print **`Storage type: <mem1 first 2 chars>, used: <n>, total: <m>\n`** (only mem1 of the three triples, e.g. `+CPMS: "ME",3,255,"ME",3,255,"ME",3,255` -> `Storage type: ME, used: 3, total: 255`); parse failure -> stderr "unparsable CPMS response", stop. Stops at `OK`; an ERROR line is not handled (runs to the alarm, exit 2). Note a `-s` CPMS sets mem1 only (mem2/3 per modem rules).

## 6. delete (M:460-487)
No alarm, no CPMS (storage = current mem1). `idx = atoi(arg)` (non-numeric non-"all" -> 0). `all` => i=0..49 (50 commands, **messages above index 49 survive**). Prints `delete msg from <i> to <j>\n`, then for each i writes `AT+CMGD=<i>\r\n` and reads until `OK` (-> `Deleted message <i>\n`) or `+CMS ERROR:` (-> stdout `Error deleting message <i>: <buf+12>` which includes CRLF); a plain `ERROR` or `+CME ERROR` is NOT matched => blocks forever. Exit 0 always. Idiomatic alternative for a rewrite: `AT+CMGD=<i>`, and `AT+CMGD=1,4` for all (not what sms_tool does).

## 7. ussd (brief, M:523-718)
Not raw: input is 7-bit packed WITHOUT table mapping (`EncodePDUMessage`, last octet 0x00 replaced by 0x1D) hex, written as `AT+CUSD=1,"<hex>",15\r\n`; `-R`: `AT+CUSD=1,"<arg>",15\r\n` (cmdstr is 100 bytes: truncated; encode failure just prints and continues with stale buffer). alarm(10). Lines: `OK` skipped; `+CME ERROR:` -> stderr `error: <buf+12>` then exit 0; `+CUSD:` parsed by `sscanf("+CUSD:%7[^\"]\"%[^\"]\",%d")` (rc==3 ok; `-r` also accepts rc==2 for multi-line and concatenates). `-r` prints the payload raw. Otherwise payload hex -> bytes, DCS decided from the CBS table (the group-15 test has a precedence bug `lower & 0x4 == 0` so it never selects 7-bit), `-c 0/2` overrides; 7-bit: unmapped septets printed as ASCII via %s; UCS2 -> UTF-8 (surrogate return -2 corrupts the output offset). `ussd_buf[320]` overflows on long replies.

## 8. at (M:720-749)
alarm(5); write `<arg>\r\n`; stream lines verbatim to stdout (including echo, blank lines, CRLF) until `OK*` (exit 0), `ERROR*`, `COMMAND NOT SUPPORT*`, `+CME ERROR*` (exit 1; the terminating line is printed only with -D). `+CMS ERROR` is not recognised (-> alarm, exit 2).

## 9. Upstream improvements (HEAD, not in the shipped binary) worth adopting in the Rust rewrite
- Send: any input byte >= 0x80 selects UCS2 (DCS `0x08`, UTF-8->UCS-2 BMP, 4-byte UTF-8 rejected; invalid UTF-8 rejected). Single message limits: 160 septets (ESC pairs count 2) or 70 UCS2 units (140 octets). Longer => multipart: 153 septets or 67 UCS2 units (134 octets) per part, never splitting an ESC pair; max 255 parts; first octet `0x51` (SUBMIT|UDHI); UDH `05 00 03 <ref> <total> <part>`; `ref=(time^pid)&0xFF`; GSM7 UDL = 7 + part septets with 1 fill bit (header is 48 bits, text starts at septet 7); UCS2 UDL = 6 + octets. One `AT+CMGS` per part, all within alarm(30) re-armed per part; `+CMGS:` per part printed as `sms part i/N sent successfully: <ref>` (single: `sms sent successfully:`); failures return exit 1 (no stalls); empty text returns 0 bytes. `+` prefix => TOA 0x91 regardless of length; non-`+` <6 digits => 0x81; digit validation fixed; 255-char number limit. `AT+CMGF=0` OK/ERROR checked.
- `-w <ms>` keep reading after `OK` for `at`; fixed USSD (accumulating +CUSD parse, UCS2 auto-detect, DCS group 15 fix, surrogate guard). recv/pdu_decode unchanged in HEAD (same quirks).

## 10. Do NOT copy (summary)
Extra octet at 8k septets; MTI unchecked; 16-bit ref truncated / IEI unchecked; euro dropped; Greek tail truncation; ignoring TZ and presenting as unlabelled; unescaped sender/timestamp in JSON; `-j -r` invalid; `all` only 0-49; delete/send loops without timeout; send failure => 5 s hang + exit 2 (a rewrite should report failure immediately but may keep rc 2 for compat); `+` mangled; DEL-handling; fixed arrays (idx 1024, pdu 256, sms_txt 322, phone 40, USSD 320); `sleep(1)` instead of waiting for `>`; CR/LF junk byte on hex parse.

## 11. Test vectors (hand/Python verified; all decode outputs are the 94b66b9 behaviour)
Decode (hex PDU -> text mode content / JSON). SCA used: `07916831081010F0`.
1. `07911326040000F0040B911346610089F60000208062917314080CC8F71D14969741F977FD07` -> From `31641600986`, `08/26/02 19:37:41`, content `How are you?`. JSON `{"index":1,"sender":"31641600986","timestamp":"08/26/02 19:37:41","content":"How are you?"}`.
2. Alnum sender: `07916831081010F0040ED0D637396C7EBBCB00006201619050700002C834` -> sender `Vodafone`, `10/16/26 09:05:07`, `Hi`. Also `...040BD0C7F7FBCC2E03...` full `07916831081010F0040BD0C7F7FBCC2E030000620161905070000BC337B90C8AC966B49A0D` -> sender `Google` (11 semi-octets; remainder septet 0 stripped), `Code 123456`.
3. GSM7 ext: `07916831081010F0040B915155214365F70000620161905070000BE10D4FBC298F37C04D0F` (septets a ESC3C b ESC65 c ESC40 ESC3D) -> sender `15551234567` (no +), content `a[bc|~` (euro dropped).
4. UCS2+emoji: `07916831081010F0040C9144214365870900086201619050700012004800690020D83DDE00002000E9043420AC` -> JSON content `Hi 😀 éд€`; text mode `Hi  é д €` (emoji absent => two spaces).
5. 8-bit concat: `07916831081010F0440B915155214365F700006201619050700015050003CC0201906536FB0D8287E574D0DB5D06` -> `Hello part one`, ref 204, part 1, total 2 (`"reference":204,"part":1,"total":2`). Text start septet = (6*8+6)/7 = 7.
6. 16-bit concat: `07916831081010F0440B915155214365F70000620161905070000D06080412340302D7B79C4D06` -> `World`, **reference 52 (0x34 only, real ref 0x1234)**, part 2, total 3; text starts septet 8.
7. UCS2+UDH: `07916831081010F0440B915155214365F700086201619050700012050003770302041F04400438043204350442` -> `Привет`, ref 119, 2/3 (skip 6 bytes).
8. 8-bit data DCS 04: `07916831081010F0040B915155214365F700046201619050700003010203` -> empty content, no error.
9. Greek: `07916831081010F0040B915155214365F700006201619050700002100C` (septets 10,18 = ΔΣ) -> JSON `"Δ"` only (Σ truncated).
10. SUBMIT in storage: `0011000B916407281553F80000AA0AE8329BFD4697D9EC37` -> parsed as DELIVER: sender "", `11/21/76 12:35:00`, empty content (garbage; must be handled by MTI check).
11. Escapes: `07916831081010F0040B915155214365F70000620161905070000DF3701E2442A745AFCD4B8107` -> JSON content `say \"hi\"\/\\\nx`.
12. DCS F0, tz byte ignored: `07916831081010F00405812143F500F09921133295954A02EF35` -> sender `12345`, `12/31/99 23:59:59`, `ok`.
Send (94b66b9; text, number -> CMGS length n, PDU):
- `0123456789`,`hellohello` -> n=22, `0011000A9110325476980000B00AE8329BFD4697D9EC37`.
- `12345`,`Hi` -> n=13, `00110005812143F50000B002C834` (TOA 81).
- `491701234567`,`Hello World` -> n=24, `0011000C919471103254760000B00BC8329BFD065DDF723619`.
- `491701234567`,`a[b]{}~^|\` -> n=30, `0011000C919471103254760000B012E10D4FBCF16D509BD4A6B7A16C809B17`.
- `491701234567`,`café €` -> `caf? ?`, n=20, `0011000C919471103254760000B006E3B0F907FA01`.
- `491701234567`,`12345678` -> n=22 with the extra-octet bug (`...B00831D98C56B3DD7000`; last octet is uninitialised stack & 0x7F, shown as 00); correct is n=21, `...B00831D98C56B3DD70`.
- `+491701234567`,`Hi` -> `0011000D914B1907214365F70000B002C834` (mangled; avoid).
HEAD-style (adopt): `491701234567`,`é` -> n=16 `0011000C919471103254760008B00200E9`; 161x`x` -> part1 n=154 `0051000C919471103254760000B0A0050003AB0201F0783C...` (UDL 160), part2 n=28 `0051000C919471103254760000B00F050003AB0202F0783C1E8FC7E301` (ref 0xAB).
Files: scratchpad/port.py, vectors.py, head_enc.py, src/v94b (shipped source), src/sms_tool (HEAD clone).
