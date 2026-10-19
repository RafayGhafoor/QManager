"use client";

import { CheckIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HintIcon } from "@/components/ui/hint-icon";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";

// =============================================================================
// StrongPasswordToggle — the strength-rule choice under a new-password field
// =============================================================================
// Shared by the Change Password dialog and the setup wizard's password step.
// A boolean preference, so it is the canon `SegmentedField` pill (DESIGN.md >
// Segmented pills), not a bare Switch. Both callers are lucide routes, so the
// check glyph is lucide's. The props are the old Switch-shaped contract on
// purpose: callers did not change when the control did.

interface StrongPasswordToggleProps {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

export function StrongPasswordToggle({
  id,
  checked,
  onCheckedChange,
  disabled,
}: StrongPasswordToggleProps) {
  const { t } = useTranslation("common");
  const labelId = `${id}-label`;

  return (
    <div id={id} className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-1.5">
        <span id={labelId} className="text-sm font-medium">
          {t("password_rules.strong_label")}
        </span>
        <HintIcon label={t("password_rules.strong_hint_label")}>
          {t("password_rules.strong_hint")}
        </HintIcon>
      </div>
      <SegmentedField
        value={checked ? "on" : "off"}
        onValueChange={(next) => onCheckedChange(next === "on")}
        ariaLabel={t("password_rules.strong_label")}
        disabled={disabled}
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
