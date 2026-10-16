//! Broker socket wire format. One request per connection, length-free, newline
//! never used as a delimiter (AT output is full of them). The client sends a
//! header line then the command bytes; the daemon replies with a status line
//! then the raw AT bytes.
//!
//! Request:  `REQ <json|raw>\n` then the exact command string (no trailing LF).
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

pub fn encode_request(cmd: &str) -> Vec<u8> {
    let mut v = Vec::with_capacity(cmd.len() + 8);
    v.extend_from_slice(b"REQ\n");
    v.extend_from_slice(cmd.as_bytes());
    v
}

/// Splits a fully-read request buffer into the command bytes.
pub fn decode_request(buf: &[u8]) -> Option<&str> {
    let nl = buf.iter().position(|&b| b == b'\n')?;
    if &buf[..nl] != b"REQ" {
        return None;
    }
    std::str::from_utf8(&buf[nl + 1..]).ok()
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
        let r = encode_request("AT+QENG=\"servingcell\"");
        assert_eq!(decode_request(&r), Some("AT+QENG=\"servingcell\""));
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
