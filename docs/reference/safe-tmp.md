# Root-safe `/tmp` handling (`safe_tmp.sh`)

Ledger B4.1. Every QManager CGI and daemon runs as root, and most of them use
fixed names in `/tmp`. This note is the contract for writing such code.

## Threat and device facts

`/tmp` is world-writable and sticky. On the RM551E `fs.protected_symlinks=1`
(root does not follow another user's symlink placed directly in `/tmp`), but
`fs.protected_regular=0` and `fs.protected_fifos=0`: a regular file or FIFO
another user planted at a fixed name is opened by root's `>` and stays owned,
and rewritable, by the planter. Nothing protects the entries of a directory
another user created first, so `mkdir -p /tmp/x` followed by a write inside it
is fully steerable. QManager's own users are all root, so the real exposure is
local privilege escalation from a non-root vendor daemon. Treat it as defence
in depth, not a remote hole.

## The helper

`/usr/lib/qmanager/safe_tmp.sh` (source with `[ -f LIB ] && . LIB`; a bare
`.` of a missing file aborts the whole script under BusyBox):

| Function | Use |
|---|---|
| `qm_trusted_file PATH` | Regular, root-owned, not a symlink. Gate every `.`, exec, extract or payload read of a `/tmp` path on it. |
| `qm_owned_by_root PATH` | Exists, not a symlink, uid 0 (files or dirs). |
| `qm_root_dir DIR [MODE]` | Makes DIR a real root-owned dir (default 0700), removing anything else at that name first. Returns 1 if it cannot; never use DIR then. |
| `qm_run_dir` | Ensures and prints `/var/run/qmanager` (root 0700). Prints nothing on failure, so guard `"$(qm_run_dir)/x"` against `/x`. |
| `qm_atomic_write DEST [MODE]` | stdin to DEST via a `mktemp` sibling and `mv -f` (default 0644). Replaces a planted file, FIFO or symlink instead of writing through it. |
| `qm_read_pid PIDFILE [CMDLINE_SUBSTR]` | The pid when the file is root-owned, the pid numeric, > 1, alive and (optionally) its cmdline contains the substring. Use it before any `kill` of a pid read from `/tmp`. |

## Rules

- Downloads, extraction and work trees that root later installs or executes
  live under `/var/run/qmanager/<feature>` (OTA `update/`, DPI
  `dpi_download`, language packs `lp_download` / `lp_staging`, Tailscale
  `tailscale_dl`, speedtest `speedtest/run.sh`), or a `mktemp -d` dir
  (installer bootstrap, `run_atd_qcmd`).
- Payload files a CGI hands to a worker (config restore, language install) are
  written with `qm_atomic_write ... 0600`; the worker refuses one that is not
  `qm_trusted_file`.
- Caches root sources (`/tmp/qmanager_supported_bands.env`) are written
  atomically and sourced only when trusted; otherwise they are re-queried.
- Flags and state a daemon acts on (watchcat revert flag, SIM failover file)
  are written atomically; the daemon drops an untrusted one.
- `/tmp/qmanager_sessions` is created by `qm_create_session` (root 0700), not
  by the installer; `qm_validate_session` rejects a session whose dir or file
  is not root-owned. Login returns `session_failed` when the dir cannot be made
  trustworthy.
- Fail closed: when the helper is missing, a feature refuses to download,
  execute, source or kill, rather than falling back to the old fixed path.
- Not moved: lock files and their FD numbers (a flock target only needs to
  exist), result/progress JSON the UI only reads, and the SMS scripts (owned by
  the SMS-in-broker work).

`uninstall.sh` removes `/var/run/qmanager`; `/var/run` is tmpfs, so a reboot
clears it too.
