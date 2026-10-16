"use client";

import { useCallback, useId } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { UseTtlSettingsReturn } from "@/hooks/use-ttl-settings";
import { SettingRow } from "./setting-row";

// Bypass Hotspot is a shortcut onto the global TTL/HL setting (the TTL page's
// own backend). Ownership is value-based: 0/0 is off and interactive, 64/64 is
// ours and interactive, anything else belongs to the TTL page or a SIM profile
// and renders on but locked.
const BYPASS_TTL = 64;
const BYPASS_HL = 64;

interface BypassHotspotRowProps {
  /** Composer-owned, so it survives tab flips without refetching. */
  ttl: UseTtlSettingsReturn;
}

export function BypassHotspotRow({ ttl }: BypassHotspotRowProps) {
  const { t } = useTranslation("local-network");
  const { data, isLoading, isSaving, saveTtlHl } = ttl;
  const helperId = useId();

  const active = data?.isEnabled ?? false;
  const ttlValue = data?.ttl ?? 0;
  const hlValue = data?.hl ?? 0;
  const isBypassValues = ttlValue === BYPASS_TTL && hlValue === BYPASS_HL;
  const externallyOwned = active && !isBypassValues;

  const handleToggle = useCallback(
    async (next: boolean) => {
      const ok = next
        ? await saveTtlHl(BYPASS_TTL, BYPASS_HL)
        : await saveTtlHl(0, 0);
      if (ok) {
        toast.success(
          next
            ? t("traffic_engine.bypass_toast_enabled")
            : t("traffic_engine.bypass_toast_disabled"),
        );
      } else {
        toast.error(t("traffic_engine.bypass_toast_error"));
      }
    },
    [saveTtlHl, t],
  );

  const helper = externallyOwned
    ? t("traffic_engine.bypass_helper_external", { ttl: ttlValue, hl: hlValue })
    : active
      ? t("traffic_engine.bypass_helper_active")
      : t("traffic_engine.bypass_helper_idle");

  return (
    <SettingRow
      title={t("traffic_engine.bypass_label")}
      description={helper}
      descriptionId={helperId}
      checked={active}
      disabled={externallyOwned}
      busy={isLoading || isSaving}
      ariaLabel={t("traffic_engine.bypass_aria")}
      onChange={handleToggle}
    />
  );
}
