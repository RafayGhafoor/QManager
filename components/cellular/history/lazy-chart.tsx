"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { CHART_BOX } from "./shapes";

/**
 * The chart stack, loaded after the card shells (spec R10). `ssr: false`
 * because the build is a static export - there is no server to render it, and
 * a mismatch would be the only thing it produced. The loading state is the
 * chart box itself, so a card never changes height when the chart arrives.
 */
export const LazyHistoryChart = dynamic(
  () => import("./history-chart").then((module) => module.HistoryChart),
  {
    ssr: false,
    loading: () => <Skeleton className={cn(CHART_BOX, "rounded-tile")} />,
  },
);
