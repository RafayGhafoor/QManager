"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { useMotionReduced } from "@/components/motion-preference";
import { cn } from "@/lib/utils";

import { REFRESH_BUTTON } from "./shapes";

const K = "core_settings.basic";

export interface RefreshButtonProps {
  onClick: () => void;
  disabled?: boolean;
  /** Collapse the label to the glyph (the foot is busy with edits). */
  compact?: boolean;
}

/** Re-reads the modem. Icon plus a label that collapses when the foot is busy. */
export function RefreshButton({ onClick, disabled, compact }: RefreshButtonProps) {
  const { t } = useTranslation("cellular");
  const reduceMotion = useMotionReduced();
  const label = t(`${K}.footer.refresh`);

  return (
    <Button
      type="button"
      variant="tonal-neutral"
      size="action"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="gap-0"
    >
      <MaterialSymbol name="refresh" size={REFRESH_BUTTON.GLYPH} aria-hidden />
      <span
        className={cn(
          REFRESH_BUTTON.LABEL,
          !reduceMotion && REFRESH_BUTTON.LABEL_MOTION,
        )}
        style={{ gridTemplateColumns: compact ? "0fr" : "1fr" }}
        aria-hidden
      >
        <span className={REFRESH_BUTTON.LABEL_CLIP}>
          <span className={REFRESH_BUTTON.LABEL_TEXT}>{label}</span>
        </span>
      </span>
    </Button>
  );
}

export default RefreshButton;
