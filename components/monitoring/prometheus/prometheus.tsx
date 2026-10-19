"use client";

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
import {
  CARD_BODY,
  CARD_PAD,
  CARD_SHELL,
  CONDITION,
  GROUP,
  PAGE_ROOT,
  ROW,
  SKELETON,
} from "./shapes";

// -----------------------------------------------------------------------------
// Prometheus — the page shell: header, then one card in its three states.
// -----------------------------------------------------------------------------

const K = "prometheus";

export default function PrometheusComponent() {
  const { t } = useTranslation("monitoring");
  const hook = usePrometheusMetrics();
  const { data, isLoading, error, refresh } = hook;

  return (
    <div className={PAGE_ROOT}>
      <MonitoringPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
      />

      {data?.settings ? (
        <PrometheusCard data={data} hook={hook} />
      ) : isLoading ? (
        <PrometheusCardSkeleton />
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

function PrometheusCardSkeleton() {
  return (
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
  );
}
