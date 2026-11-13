"use client";

import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import type {
  CellChangeField,
  CellEventGroup,
  CellHistoryRange,
} from "@/types/cell-history";

import { formatClock, formatMoment } from "./derive";
import { CARD_DESC, CARD_SHELL, CARD_TITLE, EVENTS } from "./shapes";

// =============================================================================
// EventsCard — the serving cell, as it changed
// =============================================================================
// The change log, newest first. It answers the one thing the timeline cannot:
// WHICH identity field moved, and from what to what — a band change with the same
// PCI looks like one stable cell on the strip.
//
// ONE GROUP PER INSTANT. A handover changes PCI and band at the same tick, so a
// row per field would double the list for no added information.
//
// A CHANGE IS AGAINST THE LAST KNOWN VALUE, not the previous row (that is
// `derive.ts`'s job, and `derive.test.ts` pins it): the NR columns go null while
// the leg is detached, and a pairwise diff would miss the common "5G dropped and
// came back on a different PCI" case entirely.
//
// The list is capped because a bad night produces hundreds of these and the
// count is the information — "34 more" is more useful than a page of scroll.
// =============================================================================

export interface EventsCardProps {
  events: CellEventGroup[];
  range: CellHistoryRange;
}

const VISIBLE = 12;

/** One field's value: a band keeps reading as a band, a figure as a figure. */
function Value({ field, value }: { field: CellChangeField; value: string | null }) {
  if (value === null) {
    return <span className={EVENTS.QUIET}>—</span>;
  }
  if (field === "lte_band" || field === "nr_band") {
    return (
      <Tag variant={field === "nr_band" ? "nr" : "lte"} className="font-mono">
        {value}
      </Tag>
    );
  }
  return (
    <span className={field === "nr_avail" ? "tabular-nums" : "font-mono"}>
      {value}
    </span>
  );
}

export function EventsCard({ events, range }: EventsCardProps) {
  const { t } = useTranslation("cellular");
  const longSpan = range !== "1h" && range !== "3h";
  const moment = (ts: number) => (longSpan ? formatMoment(ts) : formatClock(ts));
  const shown = events.slice(0, VISIBLE);

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className="gap-1.5">
        <CardTitle className={CARD_TITLE}>{t("history.events.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("history.events.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {events.length === 0 ? (
          <p className={EVENTS.EMPTY}>{t("history.events.none")}</p>
        ) : (
          <>
            <ul className={EVENTS.LIST}>
              {shown.map((group) => (
                <li key={group.ts} className={EVENTS.ROW}>
                  <span className={EVENTS.WHEN}>{moment(group.ts)}</span>
                  {group.changes.map((change) => (
                    <span
                      key={`${group.ts}-${change.field}`}
                      className={EVENTS.CHANGE}
                    >
                      <span className="text-on-surface-variant">
                        {t(`history.events.field.${change.field}`)}
                      </span>
                      <Value field={change.field} value={change.from} />
                      <span className={EVENTS.QUIET} aria-hidden="true">
                        →
                      </span>
                      <Value field={change.field} value={change.to} />
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            {events.length > shown.length ? (
              <p className={EVENTS.FOOT}>
                {t("history.events.more", {
                  count: events.length - shown.length,
                })}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default EventsCard;
