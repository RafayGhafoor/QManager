// Number, duration and moment formatting for the SmartDNS cards.
//
// Every value on this page arrives as `number | null`, and `null` is a real
// answer ("there is no reading"), not zero. These helpers therefore return
// `null` rather than a formatted zero, so the caller can decide to draw an em
// dash — a 0 ms uptime and "never started" must never look alike.

/** A localised integer/decimal, or null when there is no value to show. */
export function formatNumber(
  value: number | null | undefined,
  locale: string,
  maximumFractionDigits = 0,
): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

export interface DurationUnits {
  day: string;
  hour: string;
  minute: string;
  second: string;
}

/**
 * A coarse "2 d 4 h" duration from seconds. Deliberately not `Intl.RelativeTime`:
 * service uptime reads as a measurement ("2 d 4 h"), not as "2 days ago".
 */
export function formatDuration(
  seconds: number | null | undefined,
  units: DurationUnits,
): string | null {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return null;
  }
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}${units.day}`);
  if (hours > 0) parts.push(`${hours}${units.hour}`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}${units.minute}`);
  if (parts.length === 0) parts.push(`${secs}${units.second}`);
  return parts.join(" ");
}

/** An epoch-seconds timestamp as a local date-time, or null when there is none. */
export function formatMoment(
  epochSeconds: number | null | undefined,
  locale: string,
): string | null {
  if (
    epochSeconds === null ||
    epochSeconds === undefined ||
    Number.isNaN(epochSeconds) ||
    epochSeconds <= 0
  ) {
    return null;
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochSeconds * 1000));
}
