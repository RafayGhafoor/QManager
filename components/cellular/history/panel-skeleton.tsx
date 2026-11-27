"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { CARD, CHART_BOX, FULL } from "./shapes";

/**
 * A card-shaped placeholder: the loaded card's own shell (`CARD`, imported, not
 * restated), a heading and description, and one `CHART_BOX`. Every panel on
 * this page is a card of that shape, so one skeleton serves them all and none
 * can shift the layout when its data arrives.
 */
export function PanelSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(CARD, FULL, className)} aria-hidden>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-40 rounded-field" />
        <Skeleton className="h-4 w-3/4 rounded-field" />
      </div>
      <Skeleton className={cn(CHART_BOX, "rounded-tile")} />
    </div>
  );
}

export default PanelSkeleton;
