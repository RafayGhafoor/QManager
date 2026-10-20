"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";

const K = "core_settings.basic";

export interface RefreshButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Re-reads the modem. The same tonal-neutral action button Band Locking uses for
 * its Refresh; the label drops to the glyph when the apply foot is narrow
 * (`@container/foot`, declared by `ApplyFoot`), and the name stays on the button.
 */
export function RefreshButton({ onClick, disabled }: RefreshButtonProps) {
  const { t } = useTranslation("cellular");
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
    >
      <MaterialSymbol name="refresh" size={18} aria-hidden />
      <span className="hidden @md/foot:inline">{label}</span>
    </Button>
  );
}

export default RefreshButton;
