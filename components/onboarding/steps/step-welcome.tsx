"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Tag } from "@/components/ui/tag";
import { DUR, EASE_STANDARD, STAGGER_STEP } from "@/lib/motion";
import { STEP_DESCRIPTION } from "../shapes";

// =============================================================================
// StepWelcome — Onboarding step 1: brand intro, staggered entrance
// =============================================================================
// The standard card entrance on the motion tokens (it used to carry its own
// 0.38 s out-quint curve), and the Tonal Q mark with no plate behind it: the
// mark is two tones of one blue and needs no container to read as the brand.

function fadeUp(i: number) {
  return {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: DUR.standard, delay: i * STAGGER_STEP, ease: EASE_STANDARD },
  };
}

export function StepWelcome() {
  const { t } = useTranslation("onboarding");
  return (
    <div className="flex flex-col gap-7">
      {/* Brand lockup */}
      <motion.div {...fadeUp(0)} className="flex items-center gap-3">
        <img
          src="/qmanager-mark.svg"
          alt=""
          aria-hidden="true"
          className="size-10 shrink-0"
        />
        <span className="text-base font-semibold tracking-tight">QManager</span>
      </motion.div>

      {/* Main message */}
      <motion.div {...fadeUp(1)} className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight whitespace-pre-line text-balance">
          {t("welcome.main_title")}
        </h1>
        <p className={`${STEP_DESCRIPTION} leading-relaxed`}>{t("welcome.subtitle")}</p>
      </motion.div>

      {/* Step preview: what the wizard will ask, label left, the one required step tagged right */}
      <motion.ul {...fadeUp(2)} className="flex flex-col gap-1.5">
        <StepPreviewItem label={t("welcome.step_preview_password")} required />
        <StepPreviewItem label={t("welcome.step_preview_network_mode")} />
        <StepPreviewItem label={t("welcome.step_preview_apn_sim")} />
        <StepPreviewItem label={t("welcome.step_preview_band_preferences")} />
        <StepPreviewItem label={t("welcome.step_preview_web_port")} />
      </motion.ul>
    </div>
  );
}

function StepPreviewItem({
  label,
  required = false,
}: {
  label: string;
  required?: boolean;
}) {
  const { t } = useTranslation("onboarding");
  return (
    <li className="flex min-h-10 items-center justify-between gap-3 rounded-pill bg-surface-container px-4 text-sm">
      <span className={required ? "font-medium" : "text-on-surface-variant"}>{label}</span>
      {required && <Tag variant="neutral">{t("shell.label_required")}</Tag>}
    </li>
  );
}
