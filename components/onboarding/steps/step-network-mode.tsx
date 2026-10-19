"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  RefreshCwIcon,
  SignalIcon,
  ZapIcon,
  LayersIcon,
} from "lucide-react";
import { OptionRow } from "../option-row";
import { postStep, stepFailureMessage } from "../post-step";
import { SECTION_LABEL, STEP_DESCRIPTION, STEP_HEADING } from "../shapes";

// =============================================================================
// StepNetworkMode — Onboarding step 3: preferred network type (optional)
// =============================================================================
// The write is read honestly: settings.sh answers 200 with success:false (and
// failed_fields) when the modem rejects a value, so the step stays put and
// toasts the reason instead of advancing over a change that never landed. Skip
// stays available, so a failure never traps the user.

const SETTINGS_ENDPOINT = "/cgi-bin/quecmanager/cellular/settings.sh";

interface StepNetworkModeProps {
  onDataChange: (data: { mode_pref: string; nr5g_mode: number } | null) => void;
  onSubmitRef: (fn: () => Promise<void>) => void;
  onLoadingChange: (loading: boolean) => void;
  onSuccess: () => void;
}

export function StepNetworkMode({
  onDataChange,
  onSubmitRef,
  onLoadingChange,
  onSuccess,
}: StepNetworkModeProps) {
  const { t } = useTranslation("onboarding");

  const NETWORK_OPTIONS = [
    {
      id: "AUTO",
      label: t("network_mode.mode_label_auto"),
      description: t("network_mode.mode_desc_auto"),
      Icon: RefreshCwIcon,
      show5gArch: false,
    },
    {
      id: "LTE",
      label: t("network_mode.mode_label_lte"),
      description: t("network_mode.mode_desc_lte"),
      Icon: SignalIcon,
      show5gArch: false,
    },
    {
      id: "NR5G",
      label: t("network_mode.mode_label_5g_only"),
      description: t("network_mode.mode_desc_5g_only"),
      Icon: ZapIcon,
      show5gArch: true,
    },
    {
      id: "LTE:NR5G",
      label: t("network_mode.mode_label_dual"),
      description: t("network_mode.mode_desc_dual"),
      Icon: LayersIcon,
      show5gArch: true,
    },
  ];

  const NR5G_ARCH_OPTIONS = [
    { id: 0, label: t("network_mode.arch_label_auto"), description: t("network_mode.arch_desc_auto") },
    { id: 1, label: t("network_mode.arch_label_nsa"), description: t("network_mode.arch_desc_nsa") },
    { id: 2, label: t("network_mode.arch_label_sa"), description: t("network_mode.arch_desc_sa") },
  ];

  const [selectedMode, setSelectedMode] = useState("AUTO");
  const [nr5gMode, setNr5gMode] = useState(0);

  const selectedOption = NETWORK_OPTIONS.find((o) => o.id === selectedMode)!;

  const handleModeSelect = (id: string) => {
    setSelectedMode(id);
    const show5g = NETWORK_OPTIONS.find((o) => o.id === id)?.show5gArch ?? false;
    const arch = show5g ? nr5gMode : 0;
    if (!show5g) setNr5gMode(0);
    if (id !== "AUTO" || arch !== 0) {
      onDataChange({ mode_pref: id, nr5g_mode: arch });
    } else {
      onDataChange(null);
    }
  };

  const handleArchSelect = (archId: number) => {
    setNr5gMode(archId);
    if (selectedMode !== "AUTO" || archId !== 0) {
      onDataChange({ mode_pref: selectedMode, nr5g_mode: archId });
    } else {
      onDataChange(null);
    }
  };

  const submit = useCallback(async () => {
    if (selectedMode === "AUTO" && nr5gMode === 0) {
      onSuccess();
      return;
    }

    onLoadingChange(true);
    const result = await postStep(SETTINGS_ENDPOINT, {
      mode_pref: selectedMode,
      nr5g_mode: nr5gMode,
    });
    onLoadingChange(false);

    if (!result.ok) {
      toast.error(stepFailureMessage(t, result, t("network_mode.toast_failed")));
      return;
    }
    onSuccess();
  }, [selectedMode, nr5gMode, onLoadingChange, onSuccess, t]);

  useEffect(() => {
    onSubmitRef(submit);
  }, [submit, onSubmitRef]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className={STEP_HEADING}>{t("network_mode.heading")}</h2>
        <p className={STEP_DESCRIPTION}>{t("network_mode.description")}</p>
      </div>

      <div
        role="radiogroup"
        aria-label={t("network_mode.aria_network_type")}
        className="flex flex-col gap-1.5"
      >
        {NETWORK_OPTIONS.map((option) => (
          <OptionRow
            key={option.id}
            selected={selectedMode === option.id}
            onSelect={() => handleModeSelect(option.id)}
            label={option.label}
            detail={option.description}
            icon={<option.Icon className="size-4" />}
          />
        ))}
      </div>

      {/* 5G architecture — only for the 5G modes, grouped under its own label */}
      {selectedOption.show5gArch && (
        <div className="flex flex-col gap-2.5">
          <p id="onboard-arch-label" className={SECTION_LABEL}>
            {t("network_mode.arch_section_label")}
          </p>
          <div
            role="radiogroup"
            aria-labelledby="onboard-arch-label"
            className="flex flex-col gap-1.5"
          >
            {NR5G_ARCH_OPTIONS.map((arch) => (
              <OptionRow
                key={arch.id}
                size="sm"
                selected={nr5gMode === arch.id}
                onSelect={() => handleArchSelect(arch.id)}
                label={arch.label}
                detail={arch.description}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
