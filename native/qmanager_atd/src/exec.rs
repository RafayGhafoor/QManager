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

impl<D: Device> Executor<'_, D> {
    pub fn run(&mut self, cmd: &str) -> Outcome {
        let long = classify::is_long(cmd);

        // A long command is in progress: short commands fast-reject, exactly
        // like legacy qcmd's LONG_FLAG branch.
        if !long && std::path::Path::new(LONG_FLAG).exists() {
            self.log.log(crate::log::Level::Debug, &format!("LOCK: Blocked by long command"));
            return Outcome::Err(Code::ScanInProgress);
        }

        let budget = if long { LOCK_WAIT_LONG } else { LOCK_WAIT_SHORT };
        let _held = match self.lock.acquire(budget) {
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
