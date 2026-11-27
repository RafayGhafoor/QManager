"use client";

import { cn } from "@/lib/utils";

import { SERIES_KEY } from "./shapes";

// =============================================================================
// SeriesKey — a legend drawn as the strokes themselves
// =============================================================================
// Each entry is the series' own colour AND its own dash pattern, because two
// series of one hue (four antenna ports, two LTE carriers) are told apart by
// dash, and a key that drew both as a solid rule would not name either.
//
// With `onSelect` the entries are buttons: the card owns which series is
// isolated and this component only reports the click. Without it the key is a
// plain list.
// =============================================================================

export interface SeriesKeyItem {
  key: string;
  label: string;
  color: string;
  dash?: string;
  opacity?: number;
  /** A trailing figure, e.g. a median. Already formatted. */
  value?: string;
}

export interface SeriesKeyProps {
  items: readonly SeriesKeyItem[];
  ariaLabel: string;
  /** The isolated series key, or `null` when all are shown. */
  isolated?: string | null;
  onSelect?: (key: string) => void;
}

export function SeriesSwatch({
  color,
  dash,
  opacity = 1,
}: Pick<SeriesKeyItem, "color" | "dash" | "opacity">) {
  return (
    <svg
      className={SERIES_KEY.SWATCH}
      viewBox="0 0 20 8"
      aria-hidden="true"
      focusable="false"
    >
      <line
        x1="1"
        x2="19"
        y1="4"
        y2="4"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={dash}
        strokeOpacity={opacity}
      />
    </svg>
  );
}

export function SeriesKey({
  items,
  ariaLabel,
  isolated = null,
  onSelect,
}: SeriesKeyProps) {
  return (
    <ul className={SERIES_KEY.LIST} aria-label={ariaLabel}>
      {items.map((item) => {
        const dimmed = isolated !== null && isolated !== item.key;
        const body = (
          <>
            <SeriesSwatch
              color={item.color}
              dash={item.dash}
              opacity={item.opacity}
            />
            <span>{item.label}</span>
            {item.value ? (
              <span className={SERIES_KEY.VALUE}>{item.value}</span>
            ) : null}
          </>
        );
        return (
          <li key={item.key}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(item.key)}
                aria-pressed={isolated === item.key}
                className={cn(
                  SERIES_KEY.ITEM,
                  isolated === item.key && SERIES_KEY.ITEM_ACTIVE,
                  dimmed && SERIES_KEY.ITEM_DIM,
                )}
              >
                {body}
              </button>
            ) : (
              <span className={SERIES_KEY.ITEM}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default SeriesKey;
