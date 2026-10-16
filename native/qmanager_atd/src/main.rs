//! qmanager_atd — one static aarch64-musl multicall binary.
//!
//! Invoked as `qmanager_atd` (or `--daemon`): run the broker — own /dev/smd11,
//! serve one request per unix-socket connection, serialised by the modem lock.
//!
//! Invoked as `qcmd` (argv[0] basename, or `--qcmd`): behave exactly like the
//! legacy shell qcmd. Try the broker socket first; if it is absent or errors at
//! the transport level, fall back to running the exchange in-process (same
//! code the daemon runs), so AT never depends on the daemon being up.
//!
//! The AT path is the same `exec::Executor` in both the daemon and the
//! fallback, so there is one behaviour, not two.

mod channel;
mod classify;
mod exec;
mod lock;
mod log;
mod output;
mod proto;
mod safefs;

use channel::{open_smd, Channel};
use exec::{Executor, Outcome};
use lock::LockFile;
use log::Logger;
use output::{json_error, json_success, shell_capture, Code};
use std::io::{Read, Write};
use std::os::unix::io::AsRawFd;
use std::os::unix::net::{UnixListener, UnixStream};
use std::time::Duration;

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

    let mut ch = new_channel();
    for conn in listener.incoming() {
        match conn {
            Ok(stream) => serve(stream, &mut ch, &lock, &log),
            Err(e) => log.warn(&format!("accept failed: {e}")),
        }
    }
    0
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
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    // Read the whole request: header line then command. The client half-closes
    // its write side after sending, so we read to EOF.
    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
            Err(_) => break,
        }
        // A request is small; stop once we have the header and some payload and
        // the peer paused. Simplest correct rule: keep reading until EOF, but
        // cap to avoid a stuck peer.
        if buf.len() > 8192 {
            break;
        }
    }
    let cmd = match proto::decode_request(&buf) {
        Some(c) if !c.is_empty() => c.to_string(),
        _ => {
            let _ = stream.write_all(&proto::encode_reply(&proto::Reply::Err(Code::CommandFailed)));
            return;
        }
    };
    let reply = match (Executor { ch, lock, log }).run(&cmd) {
        Outcome::Ok(raw) => proto::Reply::Ok(raw),
        Outcome::Err(code) => proto::Reply::Err(code),
    };
    let _ = stream.write_all(&proto::encode_reply(&reply));
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
            eprintln!(r#"{{"error":"no_command","detail":"Usage: qcmd [-j] \"AT+COMMAND\""}}"#);
            return 1;
        }
    };

    let reply = match try_broker(command) {
        Some(r) => r,
        None => run_in_process(command),
    };
    emit(json, command, reply)
}

/// Returns None only on a transport-level failure (no socket, short write,
/// malformed reply) — then the caller falls back. A clean ERR reply is Some.
fn try_broker(cmd: &str) -> Option<proto::Reply> {
    let mut stream = UnixStream::connect(proto::SOCKET_PATH).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(320))).ok()?;
    stream.set_write_timeout(Some(Duration::from_secs(10))).ok()?;
    stream.write_all(&proto::encode_request(cmd)).ok()?;
    stream.shutdown(std::net::Shutdown::Write).ok()?;
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).ok()?;
    proto::decode_reply(&buf)
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

fn emit(json: bool, command: &str, reply: proto::Reply) -> i32 {
    match reply {
        proto::Reply::Ok(raw) => {
            let body = shell_capture(&raw);
            if json {
                print!("{}", json_success(&body, command));
            } else {
                println!("{body}");
            }
            0
        }
        proto::Reply::Err(code) => {
            if json {
                print!("{}", json_error(code, command));
            } else {
                eprintln!("ERROR: {}", code.as_str());
            }
            1
        }
    }
}
