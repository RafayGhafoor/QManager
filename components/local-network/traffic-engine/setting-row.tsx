"use client";

import { useTranslation } from "react-i18next";
import { CheckIcon, Loader2 } from "lucide-react";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import { cn } from "@/lib/utils";
import { SETTING_ROW } from "./shapes";

/** The lucide check that SegmentedField reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

interface SettingRowProps {
  title: string;
  description: string;
  /** Id for the description, so the control can point at it. */
  descriptionId?: string;
  checked: boolean;
  disabled?: boolean;
  /** A save is in flight: a spinner rides beside the title, the pills lock. */
  busy?: boolean;
  ariaLabel: string;
  onChange: (next: boolean) => void;
}

/**
 * A setting's tonal tile with an On / Off pill group, never a bare switch.
 * The engine enable row and the Bypass Hotspot row both render this, so the
 * two rows on the Video and Masquerade panels can never drift apart.
 */
export function SettingRow({
  title,
  description,
  descriptionId,
  checked,
  disabled,
  busy,
  ariaLabel,
  onChange,
}: SettingRowProps) {
  const { t } = useTranslation("common");
  return (
    <div
      className={cn(
        SETTING_ROW.ROOT,
        SETTING_ROW.TRANSITION,
        checked ? SETTING_ROW.ON : SETTING_ROW.REST,
      )}
    >
      <div className={SETTING_ROW.TEXT}>
        <p className={SETTING_ROW.TITLE}>
          {title}
          {busy ? (
            <Loader2 className={SETTING_ROW.SPINNER} aria-hidden="true" />
          ) : null}
        </p>
        <p id={descriptionId} className={SETTING_ROW.DESC}>
          {description}
        </p>
      </div>
      <SegmentedField
        value={checked ? "on" : "off"}
        onValueChange={(next) => onChange(next === "on")}
        ariaLabel={ariaLabel}
        disabled={disabled || busy}
        breakpoint="never"
        glyph={renderCheckGlyph}
        options={[
          { value: "off", label: t("state.off") },
          { value: "on", label: t("state.on") },
        ]}
      />
    </div>
  );
}
