//! The AT channel (/dev/smd11). glink_pkt does the framing in the kernel, so
//! this is plain read/write. What atcli_smd11 lacked, and this adds:
//! - a real deadline on every read (poll), so a stalled glink read can no
//!   longer hold the modem lock for 300 s;
//! - a drain before each send, so a late reply or unsolicited line left in the
//!   channel never leaks into the next caller's output;
//! - resync (AT -> OK) after a timeout, and reopen if the channel stays dead.
//!
//! Callers must hold /var/lock/qmanager.lock for the whole exchange. The
//! channel is never read outside an exchange, because sms_tool opens the same
//! device under the same lock (verified on-device: a second opener still gets
//! its own reply while this fd stays open and idle).

use std::fs::{File, OpenOptions};
use std::io;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::io::{AsRawFd, RawFd};
use std::time::{Duration, Instant};

/// Final result codes, identical to atcli_smd11 (prefix match on a full line).
pub const TERMINATORS: &[&[u8]] = &[
    b"+CME ERROR:",
    b"+CMS ERROR:",
    b"BUSY\r\n",
    b"ERROR\r\n",
    b"NO ANSWER\r\n",
    b"NO CARRIER\r\n",
    b"NO DIALTONE\r\n",
    b"OK\r\n",
];

pub fn is_terminator(line: &[u8]) -> bool {
    TERMINATORS.iter().any(|t| line.starts_with(t))
}

#[derive(Debug)]
pub enum AtError {
    /// No final result code before the deadline.
    Timeout,
    /// The device returned EOF (e.g. baseband SSR).
    Eof,
    Io(io::Error),
    /// Resync failed even after reopening the device.
    NotReady,
}

/// Anything that can stand in for the modem (the device file, or a socket in tests).
pub trait Device: AsRawFd {}
impl Device for File {}
impl Device for std::os::unix::net::UnixStream {}

pub struct Channel<D: Device> {
    opener: Box<dyn Fn() -> io::Result<D> + Send>,
    dev: Option<D>,
    dirty: bool,
    /// Bytes read past a terminator (a URC glued onto the reply) that belong to
    /// no command. Folded into the next drain so they are logged, not returned.
    pending: Vec<u8>,
    /// Bytes drained before the last send (stale replies or URCs), for logging.
    pub last_drained: Vec<u8>,
}

pub fn open_smd(path: &str) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOCTTY | libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(path)
}

fn poll_fd(fd: RawFd, events: i16, timeout: Duration) -> io::Result<bool> {
    let mut pfd = libc::pollfd { fd, events, revents: 0 };
    let ms = timeout.as_millis().min(i32::MAX as u128) as i32;
    loop {
        let r = unsafe { libc::poll(&mut pfd, 1, ms) };
        if r < 0 {
            let e = io::Error::last_os_error();
            if e.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return Err(e);
        }
        return Ok(r > 0);
    }
}

fn raw_read(fd: RawFd, buf: &mut [u8]) -> io::Result<usize> {
    let n = unsafe { libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
    if n < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(n as usize)
    }
}

fn raw_write(fd: RawFd, buf: &[u8]) -> io::Result<usize> {
    let n = unsafe { libc::write(fd, buf.as_ptr() as *const libc::c_void, buf.len()) };
    if n < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(n as usize)
    }
}

fn would_block(e: &io::Error) -> bool {
    matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted)
}

fn remaining(deadline: Instant) -> Option<Duration> {
    deadline.checked_duration_since(Instant::now()).filter(|d| !d.is_zero())
}

impl<D: Device> Channel<D> {
    pub fn new(opener: Box<dyn Fn() -> io::Result<D> + Send>) -> Self {
        Channel { opener, dev: None, dirty: false, pending: Vec::new(), last_drained: Vec::new() }
    }

    pub fn close(&mut self) {
        self.dev = None;
        self.pending.clear();
    }

    fn fd(&mut self) -> Result<RawFd, AtError> {
        if self.dev.is_none() {
            self.dev = Some((self.opener)().map_err(AtError::Io)?);
        }
        Ok(self.dev.as_ref().unwrap().as_raw_fd())
    }

    /// Reads and discards whatever is already queued, until `quiet` passes
    /// with nothing new (capped at 1 s total).
    fn drain(&mut self, quiet: Duration) -> Result<Vec<u8>, AtError> {
        let fd = self.fd()?;
        let cap = Instant::now() + Duration::from_secs(1);
        // Anything left past a previous terminator is stale too.
        let mut out = std::mem::take(&mut self.pending);
        let mut buf = [0u8; 4096];
        while Instant::now() < cap {
            match poll_fd(fd, libc::POLLIN, quiet) {
                Ok(false) => break,
                Ok(true) => {}
                Err(e) => return Err(AtError::Io(e)),
            }
            match raw_read(fd, &mut buf) {
                Ok(0) => {
                    self.close();
                    return Err(AtError::Eof);
                }
                Ok(n) => out.extend_from_slice(&buf[..n]),
                Err(e) if would_block(&e) => break,
                Err(e) => return Err(AtError::Io(e)),
            }
        }
        Ok(out)
    }

    fn send(&mut self, bytes: &[u8], deadline: Instant) -> Result<(), AtError> {
        let fd = self.fd()?;
        let mut off = 0;
        while off < bytes.len() {
            match raw_write(fd, &bytes[off..]) {
                Ok(n) => off += n,
                Err(e) if would_block(&e) => {
                    let left = remaining(deadline).ok_or(AtError::Timeout)?;
                    poll_fd(fd, libc::POLLOUT, left).map_err(AtError::Io)?;
                }
                Err(e) => return Err(AtError::Io(e)),
            }
        }
        Ok(())
    }

    /// Reads until a complete line that is a final result code. Returns every
    /// byte up to and including that line, exactly as atcli printed it.
    fn read_reply(&mut self, deadline: Instant) -> Result<Vec<u8>, AtError> {
        let fd = self.fd()?;
        let mut acc: Vec<u8> = Vec::with_capacity(512);
        let mut line_start = 0usize;
        let mut buf = [0u8; 4096];
        loop {
            // Check every complete line received so far.
            while let Some(rel) = acc[line_start..].iter().position(|&b| b == b'\n') {
                let end = line_start + rel + 1;
                if is_terminator(&acc[line_start..end]) {
                    // Bytes after the terminator are a glued URC: keep them for
                    // the next drain rather than discarding or returning them.
                    if end < acc.len() {
                        self.pending.extend_from_slice(&acc[end..]);
                    }
                    acc.truncate(end);
                    return Ok(acc);
                }
                line_start = end;
            }
            let left = match remaining(deadline) {
                Some(d) => d,
                None => {
                    self.dirty = true;
                    return Err(AtError::Timeout);
                }
            };
            match poll_fd(fd, libc::POLLIN, left) {
                Ok(false) => continue,
                Ok(true) => {}
                Err(e) => return Err(AtError::Io(e)),
            }
            match raw_read(fd, &mut buf) {
                Ok(0) => {
                    self.close();
                    return Err(AtError::Eof);
                }
                Ok(n) => acc.extend_from_slice(&buf[..n]),
                Err(e) if would_block(&e) => {}
                Err(e) => return Err(AtError::Io(e)),
            }
        }
    }

    fn try_sync(&mut self) -> Result<(), AtError> {
        self.drain(Duration::from_millis(200))?;
        let deadline = Instant::now() + Duration::from_secs(3);
        self.send(b"AT\r\n", deadline)?;
        let reply = self.read_reply(deadline)?;
        if reply.windows(4).any(|w| w == b"OK\r\n") {
            Ok(())
        } else {
            Err(AtError::NotReady)
        }
    }

    /// After a timeout the modem may still answer the old command later.
    /// Prove the channel is back in step before reusing it; reopen once if not.
    fn resync(&mut self) -> Result<(), AtError> {
        if self.try_sync().is_ok() {
            self.dirty = false;
            return Ok(());
        }
        self.close();
        match self.try_sync() {
            Ok(()) => {
                self.dirty = false;
                Ok(())
            }
            Err(_) => Err(AtError::NotReady),
        }
    }

    /// One AT exchange. The caller holds the modem lock.
    pub fn exchange(&mut self, cmd: &str, deadline: Instant) -> Result<Vec<u8>, AtError> {
        if self.dirty {
            self.resync()?;
        }
        self.last_drained = self.drain(Duration::from_millis(20))?;
        let mut line = Vec::with_capacity(cmd.len() + 2);
        line.extend_from_slice(cmd.as_bytes());
        line.extend_from_slice(b"\r\n");
        self.send(&line, deadline)?;
        self.read_reply(deadline)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::os::unix::net::UnixStream;
    use std::sync::{Arc, Mutex};
    use std::thread;

    /// A fake modem on the far end of a socketpair. `script` maps each received
    /// command line to the bytes to answer (None = never answer).
    fn fake_modem(
        script: impl Fn(&str) -> Option<Vec<u8>> + Send + 'static,
    ) -> (Channel<UnixStream>, Arc<Mutex<Vec<String>>>) {
        let (near, mut far) = UnixStream::pair().unwrap();
        near.set_nonblocking(true).unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 1024];
            let mut acc = Vec::new();
            loop {
                let n = match far.read(&mut buf) {
                    Ok(0) | Err(_) => return,
                    Ok(n) => n,
                };
                acc.extend_from_slice(&buf[..n]);
                while let Some(p) = acc.windows(2).position(|w| w == b"\r\n") {
                    let cmd = String::from_utf8_lossy(&acc[..p]).to_string();
                    acc.drain(..p + 2);
                    seen2.lock().unwrap().push(cmd.clone());
                    if let Some(r) = script(&cmd) {
                        let _ = far.write_all(&r);
                    }
                }
            }
        });
        let slot = Mutex::new(Some(near));
        let ch = Channel::new(Box::new(move || {
            slot.lock().unwrap().take().ok_or_else(|| io::Error::other("reopen not supported"))
        }));
        (ch, seen)
    }

    fn soon(ms: u64) -> Instant {
        Instant::now() + Duration::from_millis(ms)
    }

    #[test]
    fn returns_echo_body_and_terminator_like_atcli() {
        let (mut ch, _) = fake_modem(|c| Some(format!("{c}\r\r\n+CSQ: 24,99\r\n\r\nOK\r\n").into_bytes()));
        let r = ch.exchange("AT+CSQ", soon(500)).unwrap();
        assert_eq!(r, b"AT+CSQ\r\r\n+CSQ: 24,99\r\n\r\nOK\r\n");
    }

    #[test]
    fn at_error_is_a_normal_reply_not_a_failure() {
        let (mut ch, _) = fake_modem(|c| Some(format!("{c}\r\r\nERROR\r\n").into_bytes()));
        assert_eq!(ch.exchange("AT+FOOBAR", soon(500)).unwrap(), b"AT+FOOBAR\r\r\nERROR\r\n");
    }

    #[test]
    fn cme_error_terminates() {
        let (mut ch, _) = fake_modem(|c| Some(format!("{c}\r\r\n+CME ERROR: 10\r\n").into_bytes()));
        assert!(ch.exchange("AT+CPIN?", soon(500)).unwrap().ends_with(b"+CME ERROR: 10\r\n"));
    }

    #[test]
    fn ok_inside_a_line_is_not_a_terminator() {
        let (mut ch, _) = fake_modem(|c| Some(format!("{c}\r\r\n+X: \"OK\r\n\"\r\nOK\r\n").into_bytes()));
        let r = ch.exchange("AT+X", soon(500)).unwrap();
        assert!(r.ends_with(b"\r\nOK\r\n"));
    }

    #[test]
    fn deadline_ends_a_silent_command_and_resync_recovers() {
        // First command never answers; the late reply arrives with the resync.
        let (mut ch, seen) = fake_modem(|c| match c {
            "AT+HANG" => None,
            "AT" => Some(b"AT+HANG\r\r\nLATE\r\nOK\r\nAT\r\r\nOK\r\n".to_vec()),
            c => Some(format!("{c}\r\r\nOK\r\n").into_bytes()),
        });
        let t = Instant::now();
        assert!(matches!(ch.exchange("AT+HANG", soon(150)), Err(AtError::Timeout)));
        assert!(t.elapsed() < Duration::from_millis(600));
        // The next caller gets only its own reply, never the late one.
        let r = ch.exchange("AT+NEXT", soon(1000)).unwrap();
        assert_eq!(r, b"AT+NEXT\r\r\nOK\r\n");
        assert!(seen.lock().unwrap().iter().any(|c| c == "AT"), "resync sent AT");
    }

    #[test]
    fn stale_bytes_are_drained_before_send() {
        let (mut ch, _) = fake_modem(|c| match c {
            "AT+ONE" => Some(b"AT+ONE\r\r\nOK\r\n+QIND: \"urc\"\r\n".to_vec()),
            c => Some(format!("{c}\r\r\nOK\r\n").into_bytes()),
        });
        ch.exchange("AT+ONE", soon(500)).unwrap();
        thread::sleep(Duration::from_millis(30));
        let r = ch.exchange("AT+TWO", soon(500)).unwrap();
        assert_eq!(r, b"AT+TWO\r\r\nOK\r\n");
        assert!(String::from_utf8_lossy(&ch.last_drained).contains("+QIND"));
    }

    #[test]
    fn split_reads_reassemble_lines() {
        let (near, mut far) = UnixStream::pair().unwrap();
        near.set_nonblocking(true).unwrap();
        thread::spawn(move || {
            let mut b = [0u8; 64];
            let _ = far.read(&mut b);
            for chunk in [&b"AT\r"[..], b"\r\nO", b"K", b"\r\n"] {
                far.write_all(chunk).unwrap();
                thread::sleep(Duration::from_millis(15));
            }
            thread::sleep(Duration::from_millis(500));
        });
        let slot = Mutex::new(Some(near));
        let mut ch: Channel<UnixStream> =
            Channel::new(Box::new(move || slot.lock().unwrap().take().ok_or_else(|| io::Error::other("x"))));
        assert_eq!(ch.exchange("AT", soon(1000)).unwrap(), b"AT\r\r\nOK\r\n");
    }

    #[test]
    fn eof_is_reported() {
        let (near, far) = UnixStream::pair().unwrap();
        near.set_nonblocking(true).unwrap();
        drop(far);
        let slot = Mutex::new(Some(near));
        let mut ch: Channel<UnixStream> =
            Channel::new(Box::new(move || slot.lock().unwrap().take().ok_or_else(|| io::Error::other("x"))));
        assert!(matches!(ch.exchange("AT", soon(300)), Err(AtError::Eof) | Err(AtError::Io(_))));
    }
}
