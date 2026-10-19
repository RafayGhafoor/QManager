"use client";

import { ActivityIcon, CircleDashedIcon, GaugeIcon, PowerOffIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { PrometheusStatusResponse } from "@/types/prometheus-metrics";

import { CHIP_GLYPH, STATUS_BAND } from "./shapes";

const K = "prometheus";

/**
 * Whether Prometheus is actually scraping. Reads the SAVED state, not the
 * draft: a toggle flipped but not saved changes nothing here (State-Honesty).
 * Always mounted, so the page does not jump when the endpoint turns on.
 */
export function ScrapeStatus({ data }: { data: PrometheusStatusResponse }) {
  const { t } = useTranslation("monitoring");
  const enabled = data.settings?.enabled ?? false;
  const last = data.last_scrape;

  return (
    <Card className={STATUS_BAND.SHELL}>
      <div className={STATUS_BAND.ROW} role="status">
        <span className={STATUS_BAND.LABEL}>{t(`${K}.status.label`)}</span>
        <div className={STATUS_BAND.CHIPS}>
          {!enabled ? (
            <Badge variant="muted">
              <PowerOffIcon className={CHIP_GLYPH} aria-hidden="true" />
              {t(`${K}.status.endpoint_off`)}
            </Badge>
          ) : last ? (
            <Badge variant="info">
              <ActivityIcon className={CHIP_GLYPH} aria-hidden="true" />
              {lastScrapeLabel(t, last.age_seconds)}
            </Badge>
          ) : (
            <Badge variant="muted">
              <CircleDashedIcon className={CHIP_GLYPH} aria-hidden="true" />
              {t(`${K}.facts.no_scrapes`)}
            </Badge>
          )}
          {enabled && data.holding ? (
            <Badge variant="info">
              <GaugeIcon className={CHIP_GLYPH} aria-hidden="true" />
              {t(`${K}.facts.holding`)}
            </Badge>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function lastScrapeLabel(
  t: ReturnType<typeof useTranslation>["t"],
  ageSeconds: number,
): string {
  const age = Math.max(0, Math.round(ageSeconds));
  if (age < 60) return t(`${K}.facts.last_scrape_seconds`, { count: age });
  if (age < 3600)
    return t(`${K}.facts.last_scrape_minutes`, { count: Math.floor(age / 60) });
  return t(`${K}.facts.last_scrape_hours`, { count: Math.floor(age / 3600) });
}
