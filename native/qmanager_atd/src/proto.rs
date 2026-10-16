//! Broker socket wire format. One request per connection, length-free, newline
//! never used as a delimiter (AT output is full of them). The client sends a
//! header line then the command bytes; the daemon replies with a status line
//! then the raw AT bytes.
//!
//! Request:  `REQ <nbytes> <sent_ms>\n` then exactly nbytes of command (no
//!           trailing LF). `sent_ms` is CLOCK_MONOTONIC (system-wide) when the
//!           client sent it, so the daemon knows how long it sat in the queue.
//!           A body shorter or longer than nbytes is refused, never executed.
//! Reply OK: `OK <nbytes>\n` then nbytes of raw AT output.
//! Reply ER: `ERR <code>\n` (nothing after).
//!
//! The daemon never applies JSON formatting; the client does, so the daemon
//! stays a pure transport and formatting lives in one place (output.rs).

use crate::output::Code;

pub const SOCKET_PATH: &str = "/var/run/qmanager_atd.sock";

pub enum Reply {
    Ok(Vec<u8>),
    Err(Code),
}

/// Milliseconds on CLOCK_MONOTONIC, shared by every process on the host.
pub fn mono_ms() -> u64 {
    let mut ts: libc::timespec = unsafe { std::mem::zeroed() };
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
    ts.tv_sec as u64 * 1000 + ts.tv_nsec as u64 / 1_000_000
}

pub fn encode_request(cmd: &str, sent_ms: u64) -> Vec<u8> {
    let mut v = format!("REQ {} {}\n", cmd.len(), sent_ms).into_bytes();
    v.extend_from_slice(cmd.as_bytes());
    v
}

pub struct Request<'a> {
    pub cmd: &'a str,
    pub sent_ms: u64,
}

/// Splits a fully-read request buffer. None unless the header is well formed
/// and the body is exactly the announced length: a truncated or padded request
/// must never reach the modem.
pub fn decode_request(buf: &[u8]) -> Option<Request<'_>> {
    let nl = buf.iter().position(|&b| b == b'\n')?;
    let header = std::str::from_utf8(&buf[..nl]).ok()?;
    let mut it = header.split(' ');
    if it.next()? != "REQ" {
        return None;
    }
    let len: usize = it.next()?.parse().ok()?;
    let sent_ms: u64 = it.next()?.parse().ok()?;
    if it.next().is_some() {
        return None;
    }
    let body = &buf[nl + 1..];
    if body.len() != len {
        return None;
    }
    Some(Request { cmd: std::str::from_utf8(body).ok()?, sent_ms })
}

pub fn encode_reply(reply: &Reply) -> Vec<u8> {
    match reply {
        Reply::Ok(raw) => {
            let mut v = format!("OK {}\n", raw.len()).into_bytes();
            v.extend_from_slice(raw);
            v
        }
        Reply::Err(code) => format!("ERR {}\n", code.as_str()).into_bytes(),
    }
}

/// Parses a fully-read reply buffer.
pub fn decode_reply(buf: &[u8]) -> Option<Reply> {
    let nl = buf.iter().position(|&b| b == b'\n')?;
    let header = std::str::from_utf8(&buf[..nl]).ok()?;
    let body = &buf[nl + 1..];
    let mut it = header.splitn(2, ' ');
    match it.next()? {
        "OK" => {
            let n: usize = it.next()?.parse().ok()?;
            if body.len() >= n {
                Some(Reply::Ok(body[..n].to_vec()))
            } else {
                None
            }
        }
        "ERR" => Code::parse(it.next()?).map(Reply::Err),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_round_trips_with_newlines_in_command() {
        // AT commands don't contain \n, but be robust anyway.
        let r = encode_request("AT+QENG=\"servingcell\"\nX", 42);
        let d = decode_request(&r).unwrap();
        assert_eq!(d.cmd, "AT+QENG=\"servingcell\"\nX");
        assert_eq!(d.sent_ms, 42);
    }

    #[test]
    fn truncated_or_padded_request_is_refused() {
        let r = encode_request("AT+QCFG=\"band\",0,1", 7);
        assert!(decode_request(&r[..r.len() - 3]).is_none());
        let mut padded = r.clone();
        padded.extend_from_slice(b"X");
        assert!(decode_request(&padded).is_none());
        assert!(decode_request(b"REQ\nAT").is_none());
        assert!(decode_request(b"REQ 2\nAT").is_none());
    }

    #[test]
    fn ok_reply_preserves_raw_bytes_including_newlines() {
        let raw = b"AT+CSQ\r\r\n+CSQ: 24,99\r\n\r\nOK\r\n".to_vec();
        let enc = encode_reply(&Reply::Ok(raw.clone()));
        match decode_reply(&enc).unwrap() {
            Reply::Ok(got) => assert_eq!(got, raw),
            _ => panic!("expected OK"),
        }
    }

    #[test]
    fn err_reply_round_trips() {
        let enc = encode_reply(&Reply::Err(Code::ModemBusy));
        match decode_reply(&enc).unwrap() {
            Reply::Err(c) => assert_eq!(c, Code::ModemBusy),
            _ => panic!("expected ERR"),
        }
    }

    #[test]
    fn partial_ok_body_is_incomplete() {
        let raw = b"ABCDEF".to_vec();
        let mut enc = encode_reply(&Reply::Ok(raw));
        enc.truncate(enc.len() - 2);
        assert!(decode_reply(&enc).is_none());
    }
}
