// =============================================================================
// Web port helpers — build the new origin and wait for it to answer
// =============================================================================
// After a port change the web server restarts (about 1 s after the reply) and
// the old origin dies. The browser stays on the same protocol, so the target
// is the HTTP port on an http page and the HTTPS port on an https page (an
// https page cannot probe http anyway: mixed content). The login cookie is
// host-scoped, not port-scoped, so the session carries over.
//
// The probe is a no-cors fetch: it resolves on any HTTP response (opaque) and
// rejects on a refused connection, which is the only signal needed. The same
// technique as components/local-network/lan-reconnecting.tsx.
// =============================================================================

import { DEFAULT_HTTP_PORT, DEFAULT_HTTPS_PORT } from "@/types/web-port";

const PROBE_TIMEOUT_MS = 1500;
const POLL_INTERVAL_MS = 1000;

/** The origin this page would have on the given ports. */
export function originForPorts(httpPort: number, httpsPort: number): string {
  const { protocol, hostname } = window.location;
  const https = protocol === "https:";
  const port = https ? httpsPort : httpPort;
  const isDefault = port === (https ? DEFAULT_HTTPS_PORT : DEFAULT_HTTP_PORT);
  const host = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `${protocol}//${host}${isDefault ? "" : `:${port}`}`;
}

async function probe(origin: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(`${origin}/?_qm=${Date.now()}`, {
      mode: "no-cors",
      cache: "no-store",
      redirect: "manual",
      signal: ctrl.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Poll `origin` until it answers or `timeoutMs` passes. Starts after
 * `graceMs`, the window in which the old server is still shutting down.
 */
export async function waitForOrigin(
  origin: string,
  { graceMs = 2500, timeoutMs = 25000 }: { graceMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  await new Promise((r) => window.setTimeout(r, graceMs));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(origin)) return true;
    await new Promise((r) => window.setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}
