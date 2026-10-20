// The service each shipped video domain belongs to, so the hostname list can
// group by service. Built from the section comments in
// `scripts/etc/qmanager/video_domains_default.txt`: edit both together.
// Service names are brands, so they are not translated.

export const VIDEO_SERVICES: readonly (readonly [string, readonly string[]])[] = [
  ["YouTube", ["googlevideo.com", "youtube.com", "ytimg.com", "yt3.ggpht.com"]],
  ["Netflix", ["netflix.com", "nflxvideo.net", "nflxso.net", "nflxext.com"]],
  ["Twitch", ["twitchcdn.net", "twitch.tv", "jtvnw.net"]],
  ["Meta", ["video.fbcdn.net"]],
  ["Disney+", ["disneyplus.com", "disney-plus.net", "bamgrid.com", "dssott.com"]],
  ["Hulu", ["hulu.com", "hulustream.com"]],
  ["Max", ["max.com", "hbomax.com"]],
  ["Prime Video", ["primevideo.com", "aiv-cdn.net", "pv-cdn.net"]],
  ["Apple TV+", ["play-edge.itunes.apple.com", "hls-svod.itunes.apple.com"]],
  ["TikTok", ["tiktokcdn.com", "tiktokv.com", "tiktokcdn-us.com"]],
  ["Paramount+", ["cbsi.com", "cbsivideo.com"]],
  ["Peacock", ["peacocktv.com"]],
];

const SERVICE_OF = new Map<string, string>(
  VIDEO_SERVICES.flatMap(([service, domains]) =>
    domains.map((d) => [d, service] as const),
  ),
);

export interface DomainGroup {
  /** A service name, or `null` for the domains the map doesn't know. */
  service: string | null;
  domains: string[];
}

/**
 * Groups a hostname list by service: unknown (custom) domains first, then the
 * services in the default file's order. Each group keeps the list's own order.
 */
export function groupDomains(domains: readonly string[]): DomainGroup[] {
  const custom: string[] = [];
  const byService = new Map<string, string[]>();
  for (const d of domains) {
    const service = SERVICE_OF.get(d.toLowerCase());
    if (!service) {
      custom.push(d);
      continue;
    }
    const list = byService.get(service);
    if (list) list.push(d);
    else byService.set(service, [d]);
  }
  const groups: DomainGroup[] = [];
  if (custom.length) groups.push({ service: null, domains: custom });
  for (const [service] of VIDEO_SERVICES) {
    const list = byService.get(service);
    if (list) groups.push({ service, domains: list });
  }
  return groups;
}
