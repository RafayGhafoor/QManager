//! qmanager_atd — one static aarch64-musl multicall binary.
//!
//! Invoked as `qmanager_atd` (or `--daemon`): run the broker — own /dev/smd11,
//! serve one request per unix-socket connection, serialised by the modem lock.
//!
//! Invoked as `qcmd` (argv[0] basename; any name without "atd"): behave
//! exactly like the original shell qcmd. Try the broker socket first; if it is absent or errors at
//! the transport level, fall back to running the exchange in-process (same
//! code the daemon runs), so AT never depends on the daemon being up.
//!
//! Invoked as `qsms`: the SMS client (list / status / send / delete, JSON on
//! stdout, see sms.rs), with the same socket-first, never-run-twice transport.
//!
//! The AT path is the same `exec::Executor` in both the daemon and the
//! fallback, so there is one behaviour, not two.

mod channel;
mod classify;
// B5.29 Phase D poll parsers + env writer; wired to `qcmd --poll` /
// `--parse-only` by the orchestrator.
#[allow(dead_code)]
mod envout;
mod exec;
mod lock;
mod log;
mod output;
#[allow(dead_code)]
mod parse;
mod pdu;
mod proto;
mod safefs;
mod sms;

use channel::{open_smd, Channel};
use exec::{Executor, Outcome};
use lock::LockFile;
use log::Logger;
use output::{json_error, json_success, shell_capture, Code};
use std::io::{Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::io::AsRawFd;
use std::os::unix::net::{UnixListener, UnixStream};
use std::os::unix::process::CommandExt;
use std::time::{Duration, Instant};

const SMD_PATH: &str = "/dev/smd11";

fn new_channel() -> Channel<std::fs::File> {
    Channel::new(Box::new(|| open_smd(SMD_PATH)))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let base = args
        .get(0)
        .and_then(|a| a.rsplit('/').next())
        .unwrap_or("qcmd")
        .to_string();

    // qsms is always a client: its arguments are message text, which may well
    // be "-d" or "--daemon".
    if base == "qsms" {
        std::process::exit(run_qsms(&args[1..]));
    }

    let daemon_mode = base.contains("atd")
        || args.iter().any(|a| a == "--daemon")
        || args.iter().any(|a| a == "-d" && base != "qcmd");

    if daemon_mode {
        std::process::exit(run_daemon());
    }
    std::process::exit(run_qcmd(&args));
}

// ---------------------------------------------------------------------------
// Daemon
// ---------------------------------------------------------------------------

fn run_daemon() -> i32 {
    let log = Logger::new("qmanager_atd");
    let lock = match LockFile::open(lock::LOCK_FILE) {
        Ok(l) => l,
        Err(e) => {
            log.error(&format!("cannot open lock file: {e}"));
            return 1;
        }
    };
    let _ = std::fs::remove_file(proto::SOCKET_PATH);
    // Root-only from the instant it exists: /dev/smd11 is crw------- root, and
    // uhttpd runs CGIs as root, so no legitimate caller needs more. Setting the
    // umask before bind (not chmod after) leaves no window where the socket is
    // reachable by other users. /var/run is root:root 0755.
    let old_mask = unsafe { libc::umask(0o177) };
    let bound = UnixListener::bind(proto::SOCKET_PATH);
    unsafe { libc::umask(old_mask) };
    let listener = match bound {
        Ok(l) => l,
        Err(e) => {
            log.error(&format!("cannot bind {}: {e}", proto::SOCKET_PATH));
            return 1;
        }
    };
    log.info(&format!("broker up, listening on {}", proto::SOCKET_PATH));
    exec::clear_stale_long_flag(&lock, &log);

    let mut ch = new_channel();
    for conn in listener.incoming() {
        match conn {
            Ok(stream) => serve(stream, &mut ch, &lock, &log),
            Err(e) => {
                // e.g. EMFILE: back off instead of spinning on the log.
                log.warn(&format!("accept failed: {e}"));
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }
    0
}

/// Largest AT request accepted. An AT command is well under 1 KB.
const MAX_REQUEST: usize = 8192;
/// Largest SMS request: 255 parts of 67 UTF-16 units is ~51 KB of UTF-8.
const MAX_SMS_REQUEST: usize = 64 * 1024;

/// True once the client closed its end completely (not just its write half),
/// i.e. nobody is waiting for this reply any more: the caller was killed while
/// queued (CGI timeout, `timeout` wrapper). Legacy qcmd, killed while waiting
/// for the lock, never ran the command either.
fn peer_gone(stream: &UnixStream) -> bool {
    let mut pfd = libc::pollfd { fd: stream.as_raw_fd(), events: 0, revents: 0 };
    let r = unsafe { libc::poll(&mut pfd, 1, 0) };
    r > 0 && pfd.revents & (libc::POLLHUP | libc::POLLERR) != 0
}

fn refuse(stream: &mut UnixStream, log: &Logger, why: &str) {
    log.warn(&format!("refused request: {why}"));
    let _ = stream.write_all(&proto::encode_reply(&proto::Reply::Err(Code::CommandFailed)));
}

/// The connecting peer's uid, from the kernel (cannot be spoofed by the peer).
fn peer_uid(stream: &UnixStream) -> Option<u32> {
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let r = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            &mut cred as *mut libc::ucred as *mut libc::c_void,
            &mut len,
        )
    };
    (r == 0).then_some(cred.uid)
}

fn serve(mut stream: UnixStream, ch: &mut Channel<std::fs::File>, lock: &LockFile, log: &Logger) {
    // Defense in depth behind the 0600 socket: only root may drive the modem,
    // the same boundary /dev/smd11 itself enforces.
    match peer_uid(&stream) {
        Some(0) => {}
        other => {
            log.warn(&format!("rejected AT request from non-root peer (uid {other:?})"));
            let _ = stream.write_all(&proto::encode_reply(&proto::Reply::Err(Code::CommandFailed)));
            return;
        }
    }
    // The client writes its whole request at once and half-closes, so a live
    // client is done in microseconds. A short timeout bounds how long a stuck
    // peer can hold up everyone queued behind it.
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    // Read the whole request to EOF. Anything that doesn't end cleanly (read
    // error, timeout, oversize) is refused: a partial command must never run.
    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
            Err(e) => return refuse(&mut stream, log, &format!("incomplete read ({e})")),
        }
        // The kind is known from the first bytes; an AT request keeps its cap.
        let cap = if buf.starts_with(b"SMS ") { MAX_SMS_REQUEST } else { MAX_REQUEST };
        if buf.len() > cap {
            return refuse(&mut stream, log, "oversize");
        }
    }
    if buf.starts_with(b"SMS ") {
        return serve_sms(stream, &buf, ch, lock, log);
    }
    let (cmd, sent_ms) = match proto::decode_request(&buf) {
        Some(r) if !r.cmd.is_empty() => (r.cmd.to_string(), r.sent_ms),
        _ => return refuse(&mut stream, log, "malformed or truncated"),
    };
    if peer_gone(&stream) {
        log.warn(&format!("caller gone before its turn, not run: {cmd}"));
        return;
    }
    let waited = Duration::from_millis(proto::mono_ms().saturating_sub(sent_ms));
    let reply = match (Executor { ch, lock, log }).run_after(&cmd, waited) {
        Outcome::Ok(raw) => proto::Reply::Ok(raw),
        Outcome::Err(code) => proto::Reply::Err(code),
    };
    let _ = stream.write_all(&proto::encode_reply(&reply));
}

fn serve_sms(mut stream: UnixStream, buf: &[u8], ch: &mut Channel<std::fs::File>, lock: &LockFile, log: &Logger) {
    let req = match proto::decode_sms_request(buf) {
        Some(r) => r,
        None => return refuse(&mut stream, log, "malformed or truncated SMS request"),
    };
    // Re-validated here: the socket is the trust boundary, not the client.
    let op = match sms::parse_args(&req.args) {
        Ok(op) => op,
        Err(e) => {
            let body = sms::error_json("bad_args", Some(&e)).into_bytes();
            let _ = stream.write_all(&proto::encode_reply(&proto::Reply::Res(false, body)));
            return;
        }
    };
    if peer_gone(&stream) {
        log.warn(&format!("caller gone before its turn, not run: {}", op.label()));
        return;
    }
    let waited = Duration::from_millis(proto::mono_ms().saturating_sub(req.sent_ms));
    let (ok, json) = sms::run(&mut Executor { ch, lock, log }, &op, waited);
    let _ = stream.write_all(&proto::encode_reply(&proto::Reply::Res(ok, json.into_bytes())));
}

// ---------------------------------------------------------------------------
// qcmd client (+ in-process fallback)
// ---------------------------------------------------------------------------

fn run_qcmd(args: &[String]) -> i32 {
    // Parse `qcmd [-j] "AT..."`, matching the shell script.
    let mut json = false;
    let mut rest: Vec<&String> = Vec::new();
    for a in &args[1..] {
        if a == "-j" && !json {
            json = true;
        } else {
            rest.push(a);
        }
    }
    let command = match rest.first() {
        Some(c) if !c.is_empty() => c.as_str(),
        _ => {
            let _ = writeln!(
                std::io::stderr(),
                r#"{{"error":"no_command","detail":"Usage: qcmd [-j] \"AT+COMMAND\""}}"#
            );
            return 1;
        }
    };

    // Not an AT command (a typo, an unknown flag such as `--bogus`): answer at
    // once. Sent on, the modem would stay silent and the broker would hold the
    // lock for the whole deadline while every other caller fails modem_busy.
    if !classify::is_at_command(command) {
        return emit(json, command, proto::Reply::Err(Code::InvalidCommand));
    }

    // Legacy fast-reject: while a long command runs, a short one answers at
    // once instead of queueing behind it in the broker for minutes.
    if !classify::is_long(command) && exec::long_running() {
        return emit(json, command, proto::Reply::Err(Code::ScanInProgress));
    }

    let reply = match try_broker(command) {
        Broker::Reply(r) => r,
        Broker::Unreachable => run_in_process(command),
        Broker::Lost(code) => proto::Reply::Err(code),
    };
    emit(json, command, reply)
}

/// Longest an exchange can take inside the broker: the long deadline, the long
/// lock budget, the warm-up and a worst-case resync with reopen, plus margin.
const CLIENT_REPLY_TIMEOUT: Duration = Duration::from_secs(340);

enum Broker {
    Reply(proto::Reply),
    /// The request never reached the broker: safe to run it in-process.
    Unreachable,
    /// The request was delivered but no reply came back. The broker may have
    /// run it, so running it again in-process could execute a write twice.
    Lost(Code),
}

fn try_broker(cmd: &str) -> Broker {
    try_broker_raw(&proto::encode_request(cmd, proto::mono_ms()), !classify::is_long(cmd), cmd)
}

/// Sends one encoded request (AT or SMS). `short` requests watch the long
/// flag while queued; `label` is what the logs name (never message text).
fn try_broker_raw(req: &[u8], short: bool, label: &str) -> Broker {
    let mut stream = match UnixStream::connect(proto::SOCKET_PATH) {
        Ok(s) => s,
        Err(_) => return Broker::Unreachable,
    };
    if stream.set_read_timeout(Some(CLIENT_REPLY_TIMEOUT)).is_err()
        || stream.set_write_timeout(Some(Duration::from_secs(10))).is_err()
    {
        return Broker::Unreachable;
    }
    // A failed or partial write leaves a body shorter than its header says,
    // which the broker refuses, so falling back cannot double-run it.
    if stream.write_all(req).is_err() {
        return Broker::Unreachable;
    }
    if stream.shutdown(std::net::Shutdown::Write).is_err() {
        return Broker::Lost(Code::CommandFailed);
    }
    // A short command watches the long flag while it waits: one that was
    // already queued when a scan started would otherwise sit behind the whole
    // scan. Only a long command can raise the flag, and the broker runs one
    // request at a time, so while our short command is the one executing the
    // flag cannot appear: seeing it means we are still queued. Dropping the
    // socket then makes the broker skip us (peer_gone), so nothing runs twice.
    let watch = || short && exec::long_running();
    match await_reply(&mut stream, Instant::now() + CLIENT_REPLY_TIMEOUT, &watch) {
        Wait::Reply(buf) => match proto::decode_reply(&buf) {
            Some(r) => Broker::Reply(r),
            None => Broker::Lost(Code::CommandFailed),
        },
        Wait::Abandoned => Broker::Lost(Code::ScanInProgress),
        Wait::TimedOut => {
            restart_frozen_broker(label);
            Broker::Lost(Code::CommandTimeout)
        }
        Wait::Failed => Broker::Lost(Code::CommandFailed),
    }
}

/// How often a waiting client re-checks the long flag.
const WATCH_SLICE: Duration = Duration::from_millis(250);

enum Wait {
    Reply(Vec<u8>),
    /// `give_up` turned true before the reply arrived.
    Abandoned,
    /// No reply by the deadline.
    TimedOut,
    Failed,
}

/// Reads the reply to EOF in WATCH_SLICE steps, checking `give_up` between
/// steps, until `deadline`.
fn await_reply(stream: &mut UnixStream, deadline: Instant, give_up: &dyn Fn() -> bool) -> Wait {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    loop {
        let left = match deadline.checked_duration_since(Instant::now()) {
            Some(d) if !d.is_zero() => d,
            _ => return Wait::TimedOut,
        };
        if stream.set_read_timeout(Some(left.min(WATCH_SLICE))).is_err() {
            return Wait::Failed;
        }
        match stream.read(&mut tmp) {
            Ok(0) => return Wait::Reply(buf),
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return Wait::Failed,
        }
        // Only before any reply bytes: once the broker answers, take it.
        if buf.is_empty() && give_up() {
            return Wait::Abandoned;
        }
    }
}

/// Marker that serialises restarts of a frozen broker across clients.
const RESTART_MARKER: &str = "/var/run/qmanager_atd.restart";
/// At most one restart per this window, however many clients time out.
const RESTART_GAP: Duration = Duration::from_secs(120);

/// True if this caller won the right to restart: it created `marker` with
/// O_EXCL, or replaced one older than `gap`. Every other caller in the window
/// sees a fresh marker and leaves the restart to the winner.
fn claim_restart(marker: &str, gap: Duration) -> bool {
    let create = || {
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(safefs::NOFOLLOW)
            .open(marker)
            .is_ok()
    };
    if create() {
        return true;
    }
    let age = std::fs::symlink_metadata(marker)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok());
    match age {
        Some(a) if a < gap => false,
        // Old (or unreadable) marker: remove it and race for a fresh one.
        _ => std::fs::remove_file(marker).is_ok() && create(),
    }
}

/// The broker accepted our request but sent nothing back within the longest
/// possible exchange: it is alive but stuck, and procd never restarts a
/// process that has not exited. Ask the init script to restart it, detached so
/// it outlives this client, and leave the request unanswered: it may have run.
fn restart_frozen_broker(cmd: &str) {
    let log = Logger::new("qcmd");
    if !claim_restart(RESTART_MARKER, RESTART_GAP) {
        log.warn(&format!("broker gave no reply for: {cmd}; restart already requested"));
        return;
    }
    log.error(&format!(
        "broker gave no reply in {}s for: {cmd}; restarting it",
        CLIENT_REPLY_TIMEOUT.as_secs()
    ));
    let mut c = std::process::Command::new("/etc/init.d/qmanager_atd");
    c.arg("restart")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    // New session: a CGI timeout killing our process group must not kill the
    // restart half-way.
    unsafe {
        c.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    if let Err(e) = c.spawn() {
        log.error(&format!("could not restart the broker: {e}"));
    }
}

fn run_in_process(cmd: &str) -> proto::Reply {
    let log = Logger::new("qcmd");
    let lock = match LockFile::open(lock::LOCK_FILE) {
        Ok(l) => l,
        Err(_) => return proto::Reply::Err(Code::ModemBusy),
    };
    let mut ch = new_channel();
    match (Executor { ch: &mut ch, lock: &lock, log: &log }).run(cmd) {
        Outcome::Ok(raw) => proto::Reply::Ok(raw),
        Outcome::Err(code) => proto::Reply::Err(code),
    }
}

// ---------------------------------------------------------------------------
// qsms client (+ in-process fallback)
// ---------------------------------------------------------------------------

/// `qsms <op> ...`: one JSON envelope on stdout, rc 0 on success, 1 on failure.
/// Same transport rules as qcmd: socket first, in-process only if the request
/// never reached the broker, never run twice.
fn run_qsms(args: &[String]) -> i32 {
    let op = match sms::parse_args(args) {
        Ok(op) => op,
        Err(e) => return emit_sms(false, sms::error_json("bad_args", Some(&e))),
    };
    if exec::long_running() {
        return emit_sms(false, sms::error_json(Code::ScanInProgress.as_str(), None));
    }
    let label = op.label();
    let req = proto::encode_sms_request(args, proto::mono_ms());
    let (ok, json) = match try_broker_raw(&req, true, &label) {
        Broker::Reply(proto::Reply::Res(ok, body)) => (ok, String::from_utf8_lossy(&body).into_owned()),
        Broker::Reply(proto::Reply::Err(code)) | Broker::Lost(code) => (false, sms::error_json(code.as_str(), None)),
        Broker::Reply(proto::Reply::Ok(_)) => (false, sms::error_json(Code::CommandFailed.as_str(), None)),
        Broker::Unreachable => {
            let log = Logger::new("qsms");
            match LockFile::open(lock::LOCK_FILE) {
                Ok(lock) => {
                    let mut ch = new_channel();
                    sms::run(&mut Executor { ch: &mut ch, lock: &lock, log: &log }, &op, Duration::ZERO)
                }
                Err(_) => (false, sms::error_json(Code::ModemBusy.as_str(), None)),
            }
        }
    };
    emit_sms(ok, json)
}

fn emit_sms(ok: bool, json: String) -> i32 {
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(json.as_bytes());
    let _ = out.flush();
    if ok {
        0
    } else {
        1
    }
}

/// print!/println! panic when stdout is closed (EPIPE; Rust ignores SIGPIPE),
/// and with panic=abort that is a SIGABRT. Like the shell's echo, a write
/// error is ignored and the exit code still reports the AT result.
fn emit(json: bool, command: &str, reply: proto::Reply) -> i32 {
    // An SMS reply to an AT request can only be a protocol mix-up.
    if let proto::Reply::Res(..) = reply {
        return emit(json, command, proto::Reply::Err(Code::CommandFailed));
    }
    let mut out = std::io::stdout().lock();
    match reply {
        proto::Reply::Ok(raw) => {
            let body = shell_capture(&raw);
            let _ = if json {
                out.write_all(json_success(&body, command).as_bytes())
            } else {
                writeln!(out, "{body}")
            };
            let _ = out.flush();
            0
        }
        proto::Reply::Err(code) => {
            if json {
                let _ = out.write_all(json_error(code, command).as_bytes());
                let _ = out.flush();
            } else {
                let _ = writeln!(std::io::stderr(), "ERROR: {}", code.as_str());
            }
            1
        }
        proto::Reply::Res(..) => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread;

    fn soon(ms: u64) -> Instant {
        Instant::now() + Duration::from_millis(ms)
    }

    #[test]
    fn qcmd_refuses_non_at_input_at_once() {
        // Returns before the long-flag gate and the socket, so no broker is needed.
        for a in [&["qcmd", "--bogus"][..], &["qcmd", "hello"], &["qcmd", "-j", "-x"], &["qcmd", "AT\rhello"]] {
            let args: Vec<String> = a.iter().map(|s| s.to_string()).collect();
            let t = Instant::now();
            assert_eq!(run_qcmd(&args), 1, "{a:?}");
            assert!(t.elapsed() < Duration::from_millis(200), "{a:?}");
        }
    }

    #[test]
    fn queued_short_command_gives_up_when_a_scan_starts() {
        let (mut client, broker) = UnixStream::pair().unwrap();
        let scan = Arc::new(AtomicBool::new(false));
        let s2 = scan.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(300));
            s2.store(true, Ordering::SeqCst);
        });
        let t = Instant::now();
        let w = await_reply(&mut client, soon(5000), &|| scan.load(Ordering::SeqCst));
        assert!(matches!(w, Wait::Abandoned));
        // Gave up within about one slice of the flag appearing.
        assert!(t.elapsed() < Duration::from_millis(900), "{:?}", t.elapsed());
        // Dropping the client is what the broker's peer_gone check sees.
        drop(client);
        // Wait for the hang-up rather than sampling it: a test running in
        // parallel that spawns a process holds a forked copy of `client` until
        // its exec, which delays the close by a few milliseconds.
        let mut p = libc::pollfd { fd: broker.as_raw_fd(), events: 0, revents: 0 };
        unsafe { libc::poll(&mut p, 1, 2000) };
        assert!(p.revents & libc::POLLHUP != 0);
    }

    #[test]
    fn a_reply_that_has_started_is_taken_even_if_the_flag_appears() {
        let (mut client, mut broker) = UnixStream::pair().unwrap();
        thread::spawn(move || {
            broker.write_all(b"OK 4\nAB").unwrap();
            thread::sleep(Duration::from_millis(400));
            broker.write_all(b"CD").unwrap();
        });
        thread::sleep(Duration::from_millis(50));
        match await_reply(&mut client, soon(5000), &|| true) {
            Wait::Reply(b) => assert_eq!(b, b"OK 4\nABCD"),
            _ => panic!("expected the reply"),
        }
    }

    #[test]
    fn no_reply_by_the_deadline_is_a_timeout() {
        let (mut client, _broker) = UnixStream::pair().unwrap();
        let t = Instant::now();
        assert!(matches!(await_reply(&mut client, soon(600), &|| false), Wait::TimedOut));
        assert!(t.elapsed() >= Duration::from_millis(600));
    }

    #[test]
    fn only_one_restart_per_window() {
        let p = std::env::temp_dir().join(format!("qatd-restart-{}", std::process::id()));
        let p = p.to_str().unwrap();
        let _ = std::fs::remove_file(p);
        assert!(claim_restart(p, Duration::from_secs(120)));
        assert!(!claim_restart(p, Duration::from_secs(120)));
        // An old marker (a restart long ago) is replaced.
        let old = std::time::SystemTime::now() - Duration::from_secs(300);
        std::fs::File::options().write(true).open(p).unwrap().set_modified(old).unwrap();
        assert!(claim_restart(p, Duration::from_secs(120)));
        let _ = std::fs::remove_file(p);
    }
}
