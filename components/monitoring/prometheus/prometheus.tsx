"use client";

import { useState } from "react";
import { RefreshCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MonitoringPageHeader } from "@/components/monitoring/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePrometheusMetrics } from "@/hooks/use-prometheus-metrics";
import { cn } from "@/lib/utils";

import { PrometheusCard } from "./prometheus-card";
import { ScrapeConfigCard } from "./scrape-config";
import { ScrapeStatus } from "./scrape-status";
import {
  CARD_BODY,
  CARD_PAD,
  CARD_SHELL,
  CONDITION,
  GROUP,
  PAGE_PAIR,
  PAGE_ROOT,
  ROW,
  SKELETON,
  STATUS_BAND,
} from "./shapes";

// -----------------------------------------------------------------------------
// Prometheus — the page shell: header, the scrape status band, then the
// settings card paired with the scrape config card, each in its three states.
// -----------------------------------------------------------------------------

const K = "prometheus";

export default function PrometheusComponent() {
  const { t } = useTranslation("monitoring");
  const hook = usePrometheusMetrics();
  const { data, isLoading, error, refresh } = hook;
  // One reveal for the token field and the config block: showing it in one
  // place and not the other would read as two different secrets.
  const [revealed, setRevealed] = useState(false);

  const settings = data?.settings;
  const live = !!settings?.enabled && settings.token.length > 0;

  return (
    <div className={PAGE_ROOT}>
      <MonitoringPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
      />

      {data && settings ? (
        <>
          <ScrapeStatus data={data} />
          <div className={PAGE_PAIR}>
            <PrometheusCard
              data={data}
              hook={hook}
              revealed={revealed}
              onRevealedChange={setRevealed}
            />
            <ScrapeConfigCard
              endpointPath={
                data.endpoint_path ??
                "/cgi-bin/quecmanager/metrics/prometheus.sh"
              }
              httpsPort={data.https_port ?? 443}
              token={settings.token}
              live={live}
              revealed={revealed}
              onRevealedChange={setRevealed}
            />
          </div>
        </>
      ) : isLoading ? (
        <PrometheusSkeleton />
      ) : (
        <div role="alert" className={CONDITION.ROOT}>
          <span className={CONDITION.DISC}>
            <TriangleAlertIcon className={CONDITION.GLYPH} aria-hidden="true" />
          </span>
          <span className={CONDITION.TITLE}>{t(`${K}.error.title`)}</span>
          <span className={CONDITION.DESC}>
            {error ?? t(`${K}.error.description`)}
          </span>
          <Button
            type="button"
            variant="ghost"
            className={CONDITION.ACTION}
            onClick={refresh}
          >
            <RefreshCcwIcon className="size-4" aria-hidden="true" />
            {t(`${K}.error.retry`)}
          </Button>
        </div>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className={cn(ROW.ROOT, SKELETON.ROW)}>
      <div className={ROW.TEXT}>
        <Skeleton className={SKELETON.LABEL} />
        <Skeleton className={SKELETON.CONSEQUENCE} />
      </div>
      <div className={ROW.CONTROL}>
        <Skeleton className={SKELETON.PILL} />
      </div>
    </div>
  );
}

function PrometheusSkeleton() {
  return (
    <>
      <Card className={STATUS_BAND.SHELL} aria-busy="true">
        <div className={STATUS_BAND.ROW}>
          <Skeleton className={SKELETON.STATUS} />
        </div>
      </Card>
      <div className={PAGE_PAIR}>
        <Card className={CARD_SHELL} aria-busy="true">
          <CardHeader className={cn(CARD_PAD, "gap-2")}>
            <Skeleton className={SKELETON.CARD_TITLE} />
            <Skeleton className={SKELETON.CARD_DESC} />
          </CardHeader>
          <CardContent className={cn(CARD_PAD, CARD_BODY)}>
            <div className={GROUP.ROOT}>
              <div className={GROUP.COLUMN}>
                <SkeletonRow />
                <SkeletonRow />
              </div>
            </div>
            <div className={SKELETON.FOOT} />
          </CardContent>
        </Card>
        <Card className={CARD_SHELL} aria-busy="true">
          <CardHeader className={cn(CARD_PAD, "gap-2")}>
            <Skeleton className={SKELETON.CARD_TITLE} />
            <Skeleton className={SKELETON.CARD_DESC} />
          </CardHeader>
          <CardContent className={cn(CARD_PAD, CARD_BODY)}>
            <Skeleton className={SKELETON.BLOCK} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
