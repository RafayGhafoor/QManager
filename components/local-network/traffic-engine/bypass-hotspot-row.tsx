"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckIcon } from "lucide-react";
import { HintIcon } from "@/components/ui/hint-icon";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import type { UseTtlSettingsReturn } from "@/hooks/use-ttl-settings";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { cn } from "@/lib/utils";
import { FIELD, HOTSPOT_CTL, HOTSPOT_ROW } from "./shapes";

// Hotspot bypass is a shortcut onto the global TTL/HL setting (the TTL page's
// own backend). Ownership is value-based: 0/0 is off and interactive, 64/64 is
// ours and interactive, anything else belongs to the TTL page or a SIM profile
// and renders on but locked.
const BYPASS_TTL = 64;
const BYPASS_HL = 64;

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

interface BypassHotspotRowProps {
  /** Composer-owned, so the Engine card's view swaps never refetch it. */
  ttl: UseTtlSettingsReturn;
}

/** The Engine card's Hotspot bypass row: label and state left, On / Off right. */
export function BypassHotspotRow({ ttl }: BypassHotspotRowProps) {
  const { t } = useTranslation("local-network");
  const { data, isLoading, isSaving, saveTtlHl } = ttl;

  const active = data?.isEnabled ?? false;
  const ttlValue = data?.ttl ?? 0;
  const hlValue = data?.hl ?? 0;
  const externallyOwned = active && !(ttlValue === BYPASS_TTL && hlValue === BYPASS_HL);

  const handleChange = useCallback(
    async (next: boolean) => {
      const result = next
        ? await saveTtlHl(BYPASS_TTL, BYPASS_HL)
        : await saveTtlHl(0, 0);
      if (result.ok) {
        toast.success(
          t(next ? "traffic_engine.bypass_toast_enabled" : "traffic_engine.bypass_toast_disabled"),
        );
      } else {
        toast.error(
          resolveErrorMessage(t, result.code, result.error, t("traffic_engine.bypass_toast_error")),
        );
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
    <div className={cn(FIELD.ROW, HOTSPOT_ROW)}>
      <div className={FIELD.TEXT}>
        <div className={FIELD.LABEL_ROW}>
          <span className={FIELD.LABEL}>{t("traffic_engine.bypass_label")}</span>
          <HintIcon label={t("traffic_engine.aria_bypass_hint")}>
            {t("traffic_engine.bypass_hint")}
          </HintIcon>
        </div>
        <p className={FIELD.HINT}>{helper}</p>
      </div>
      <SegmentedField
        value={active ? "on" : "off"}
        onValueChange={(next) => void handleChange(next === "on")}
        ariaLabel={t("traffic_engine.bypass_label")}
        disabled={externallyOwned || isLoading || isSaving}
        breakpoint="never"
        glyph={renderCheckGlyph}
        className={HOTSPOT_CTL}
        options={[
          { value: "off", label: t("state.off", { ns: "common" }) },
          { value: "on", label: t("state.on", { ns: "common" }) },
        ]}
      />
    </div>
  );
}
