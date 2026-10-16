import * as React from "react";
import { cn } from "@/lib/utils";

// =============================================================================
// Receipt-row geometry shared by the Modem Commands and Host AT Ports cards
// =============================================================================
// Key on the left edge, value on the right edge (DESIGN.md > The Scanning
// Rules). The skeleton imports the same constant, so the loading state mirrors
// the loaded row exactly (The Skeleton-Mirror Rule).
// =============================================================================

/** One settings row: min 44px so the control is a comfortable tap target. */
export const SETTING_ROW = "flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2";
/** The row's key: same voice as the other System Settings cards. */
export const SETTING_KEY = "flex items-center gap-1.5 text-sm font-semibold text-muted-foreground";

export function SettingRow({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(SETTING_ROW, className)}>
      <div className={SETTING_KEY}>{label}</div>
      {children}
    </div>
  );
}
