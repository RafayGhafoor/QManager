//! The one execution path shared by the daemon and the in-process fallback.
//! Mirrors legacy qcmd: long-flag gate, warm-up for long commands, lock budgets,
//! error-code mapping. Output framing is produced by the caller from `Outcome`.

use crate::channel::{AtError, Channel, Device};
use crate::classify;
use crate::lock::LockFile;
use crate::log::Logger;
use crate::output::Code;
use crate::safefs::{one_line, write_nofollow};
use std::time::{Duration, Instant};

pub const LONG_FLAG: &str = "/tmp/qmanager_long_running";
pub const PID_FILE: &str = "/var/lock/qmanager.pid";

pub const SHORT_DEADLINE: Duration = Duration::from_secs(20);
pub const LONG_DEADLINE: Duration = Duration::from_secs(300);
pub const SLOW_DEADLINE: Duration = Duration::from_secs(60);
const LOCK_WAIT_SHORT: Duration = Duration::from_secs(5);
const LOCK_WAIT_LONG: Duration = Duration::from_secs(10);

pub enum Outcome {
    /// Raw bytes exactly as atcli printed them (echo + body + terminator).
    Ok(Vec<u8>),
    Err(Code),
}

pub struct Executor<'a, D: Device> {
    pub ch: &'a mut Channel<D>,
    pub lock: &'a LockFile,
    pub log: &'a Logger,
}

fn deadline_for(cmd: &str, long: bool) -> Instant {
    let d = if long {
        LONG_DEADLINE
    } else if classify::is_slow(cmd) {
        SLOW_DEADLINE
    } else {
        SHORT_DEADLINE
    };
    Instant::now() + d
}

/// Margin before a lock-free flag is treated as abandoned: a flag younger than
/// this may belong to a caller that has only just started a long command (the
/// retired shell qcmd also wrote it before waiting up to LOCK_WAIT_LONG).
const STALE_FLAG_AGE: Duration = Duration::from_secs(15);

/// True while a long command holds the modem (the scan_in_progress gate).
pub fn long_running() -> bool {
    std::path::Path::new(LONG_FLAG).exists()
}

/// Removes a long flag left by a holder that died mid-command (killed broker,
/// broker restart during a scan). Without this every short command answers
/// scan_in_progress until the main service restarts. Safe only when nobody
/// holds the modem lock and the flag is older than STALE_FLAG_AGE.
pub fn clear_stale_long_flag(lock: &LockFile, log: &Logger) {
    let age = match std::fs::symlink_metadata(LONG_FLAG).and_then(|m| m.modified()) {
        Ok(t) => t.elapsed().unwrap_or(Duration::ZERO),
        Err(_) => return,
    };
    if age < STALE_FLAG_AGE {
        return;
    }
    if let Some(_held) = lock.acquire(Duration::ZERO) {
        if std::fs::remove_file(LONG_FLAG).is_ok() {
            log.warn(&format!("Removed stale long-command flag (age {}s, modem lock free)", age.as_secs()));
        }
    }
}

impl<D: Device> Executor<'_, D> {
    pub fn run(&mut self, cmd: &str) -> Outcome {
        self.run_after(cmd, Duration::ZERO)
    }

    /// `waited` is how long the caller already queued for this exchange (time
    /// in the broker's accept queue). It counts against the lock budget, so a
    /// request waits no longer in total than legacy qcmd waited for the lock.
    pub fn run_after(&mut self, cmd: &str, waited: Duration) -> Outcome {
        let long = classify::is_long(cmd);

        // A long command is in progress: short commands fast-reject, exactly
        // like legacy qcmd's LONG_FLAG branch.
        if !long && long_running() {
            self.log.log(crate::log::Level::Debug, &format!("LOCK: Blocked by long command"));
            return Outcome::Err(Code::ScanInProgress);
        }

        let budget = if long { LOCK_WAIT_LONG } else { LOCK_WAIT_SHORT };
        if waited > budget {
            self.log.error(&format!("Lock acquisition failed for: {cmd} (queued {}ms)", waited.as_millis()));
            return Outcome::Err(Code::ModemBusy);
        }
        let _held = match self.lock.acquire(budget - waited) {
            Some(h) => h,
            None => {
                self.log.error(&format!("Lock acquisition failed for: {cmd}"));
                return Outcome::Err(Code::ModemBusy);
            }
        };
        let _ = write_nofollow(PID_FILE, format!("{}\n", std::process::id()).as_bytes());

        if long {
            let _ = write_nofollow(LONG_FLAG, format!("{}\n", one_line(cmd)).as_bytes());
            self.log.info(&format!("Long command started: {cmd}"));
            // Warm-up flush, like qcmd:191-192. A failure here is modem_not_ready.
            if let Err(e) = self.ch.exchange("AT", Instant::now() + Duration::from_secs(3)) {
                let _ = std::fs::remove_file(LONG_FLAG);
                let _ = std::fs::remove_file(PID_FILE);
                self.log.error(&format!("Modem warm-up failed before: {cmd} ({e:?})"));
                return Outcome::Err(Code::ModemNotReady);
            }
        }

        let outcome = match self.ch.exchange(cmd, deadline_for(cmd, long)) {
            Ok(raw) => {
                if !self.ch.last_drained.is_empty() {
                    let d = String::from_utf8_lossy(&self.ch.last_drained);
                    let d: String = d.chars().take(120).filter(|&c| c != '\r').map(|c| if c == '\n' { ' ' } else { c }).collect();
                    self.log.debug(&format!("drained stale/URC before {cmd}: {d}"));
                }
                self.log.at_cmd(cmd, &String::from_utf8_lossy(&raw), true);
                Outcome::Ok(raw)
            }
            Err(AtError::Timeout) => {
                self.log.error(&format!("Command killed by deadline: {cmd}"));
                Outcome::Err(Code::CommandTimeout)
            }
            Err(AtError::NotReady) => {
                self.log.error(&format!("Channel not ready for: {cmd}"));
                Outcome::Err(Code::ModemNotReady)
            }
            // The channel went away under us (SSR / glink reset): the modem is
            // restarting, the command was not at fault.
            Err(e @ AtError::Eof) => {
                self.log.error(&format!("Channel lost during: {cmd} ({e:?})"));
                Outcome::Err(Code::ModemNotReady)
            }
            Err(AtError::Io(e)) if crate::channel::is_reset(&e) => {
                self.log.error(&format!("Channel reset during: {cmd} ({e:?})"));
                Outcome::Err(Code::ModemNotReady)
            }
            Err(e) => {
                self.log.error(&format!("Command failed: {cmd} ({e:?})"));
                Outcome::Err(Code::CommandFailed)
            }
        };

        if long {
            let _ = std::fs::remove_file(LONG_FLAG);
            self.log.info(&format!("Long command completed: {cmd}"));
        }
        let _ = std::fs::remove_file(PID_FILE);
        outcome
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixStream;

    #[test]
    fn request_queued_past_the_lock_budget_is_busy_and_never_sent() {
        let p = std::env::temp_dir().join(format!("qatd-exec-lock-{}", std::process::id()));
        let lock = LockFile::open(p.to_str().unwrap()).unwrap();
        let log = Logger::new("test");
        // Opening the channel at all would mean the command reached the modem.
        let mut ch: Channel<UnixStream> = Channel::new(Box::new(|| panic!("command was sent")));
        let mut ex = Executor { ch: &mut ch, lock: &lock, log: &log };
        let out = ex.run_after("AT+CSQ", LOCK_WAIT_SHORT + Duration::from_millis(1));
        assert!(matches!(out, Outcome::Err(Code::ModemBusy)));
        let _ = std::fs::remove_file(p);
    }
}
