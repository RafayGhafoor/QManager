// The upstream pool this page offers, by URL.
//
// WHY A CURATED LIST AND NOT A FREE-TEXT FIELD
//   A smartdns `server` line is a directive in a file a root daemon reads. The
//   backend validates every value against an allowlist before rendering it, so a
//   free-text box could only ever be rejected — it would offer a control that
//   cannot work. The list represents what the backend will accept.
//
// WHY THESE THREE ARE THE DEFAULT
//   smartdns races every upstream it is given and takes the fastest answer, so
//   three endpoints is resilience rather than redundancy: one being unreachable
//   or blocked costs a race, not an answer. The reference build measured a
//   near/far split across providers on ITS carrier; those classes do not transfer
//   to this device's network, so nothing here claims a latency. Order is not
//   preference either — smartdns does not use it.
//
// Adding one means adding it here AND to `SMARTDNS_DEFAULT_UPSTREAM` in
// scripts/usr/lib/qmanager/smartdns_lib.sh only if it belongs in the shipped
// default; a provider that is merely available needs only this list.

export interface SmartDnsUpstream {
  /** Stable key for React lists and translation keys. */
  id: string;
  /** The vendor's name. A proper noun, so it is not translated. */
  name: string;
  /** The exact `server` value written into the generated config. */
  url: string;
}

export const SMARTDNS_UPSTREAMS: readonly SmartDnsUpstream[] = [
  { id: "google", name: "Google Public DNS", url: "https://dns.google/dns-query" },
  {
    id: "cloudflare",
    name: "Cloudflare",
    url: "https://cloudflare-dns.com/dns-query",
  },
  { id: "quad9", name: "Quad9", url: "https://dns.quad9.net/dns-query" },
  { id: "opendns", name: "OpenDNS", url: "https://doh.opendns.com/dns-query" },
  {
    id: "adguard",
    name: "AdGuard DNS",
    url: "https://unfiltered.adguard-dns.com/dns-query",
  },
  { id: "nextdns", name: "NextDNS", url: "https://dns.nextdns.io" },
] as const;

/** The URLs shipped as the device's default pool (see smartdns_lib.sh). */
export const DEFAULT_UPSTREAM_URLS: readonly string[] = SMARTDNS_UPSTREAMS.slice(
  0,
  3,
).map((p) => p.url);

/** A short label for a configured URL, falling back to the URL itself. */
export function upstreamLabel(url: string): string {
  return SMARTDNS_UPSTREAMS.find((p) => p.url === url)?.name ?? url;
}
