"use client";

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { transitionStandard } from "@/lib/motion";

import type {
  ProfileApplyState,
  ApplyStep,
  ApplyStepStatus,
} from "@/types/sim-profile";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

// =============================================================================
// ApplyProgressDialog — the Sequenced Pipeline Dialog
// =============================================================================
// QManager's signature shape for irreversible, multi-step apply pipelines
// (profile apply here; config-restore and language-install share it). A
// justified modal — profile activation reconfigures a live modem.
//
// Composition leads with a status HERO: a single state glyph, a headline that
// names the step in flight (or the terminal verdict), and a row of step dots
// (the Loader-and-Dots Rule: no determinate bar). The per-step list sits
// beneath as supporting detail, a compact ledger, not the primary progress
// signal. "Skipped" reads as a calm "Unchanged" (the value was already
// correct) and resolves to a check once the whole apply completes. The dialog
// never reboots the modem; a pending reboot is surfaced by the banner.
// =============================================================================

interface ApplyProgressDialogProps {
  open: boolean;
  onClose: () => void;
  applyState: ProfileApplyState | null;
  error: string | null;
}

/**
 * Default steps shown while waiting for the first poll response. Order MUST
 * mirror the worker's execution/serialization order (apn → ttl_hl → mpdn_rule →
 * imei) so the placeholder ledger doesn't reshuffle when the first real poll
 * lands. IMEI is last because it carries the AT+CFUN=1,1 reboot.
 */
const DEFAULT_STEPS: ApplyStep[] = [
  { name: "apn", status: "pending", detail: "" },
  { name: "ttl_hl", status: "pending", detail: "" },
  { name: "mpdn_rule", status: "pending", detail: "" },
  { name: "imei", status: "pending", detail: "" },
];

type Tone = "info" | "success" | "warning" | "destructive";

/**
 * The effective node status. "skipped" means "already correct"; once the whole
 * apply completes we show it as done (a check).
 */
function effectiveStatus(
  status: ApplyStepStatus,
  overall?: string,
): ApplyStepStatus {
  if (status === "skipped" && overall === "complete") return "done";
  return status;
}

/** Does this step count toward the completed fraction? */
function isTraversed(status: ApplyStepStatus): boolean {
  return status === "done" || status === "skipped";
}

/** Hero disc: the role's STRONG fill (Glyph-Disc Rule). `info` is the brand. */
const TONE_DISC: Record<Tone, string> = {
  info: "bg-primary text-primary-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  destructive: "bg-destructive text-destructive-foreground",
};

/** The progress fill, in the same role as the hero. */
const TONE_FILL: Record<Tone, string> = {
  info: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

/** The large hero glyph for the current overall state. Each state its own glyph. */
function HeroGlyph({ tone, status }: { tone: Tone; status: string }) {
  const name =
    status === "complete"
      ? "check_circle"
      : status === "partial"
        ? "warning"
        : status === "failed"
          ? "cancel"
          : "progress_activity";

  return (
    <span
      className={cn(
        "flex size-14 items-center justify-center rounded-pill",
        TONE_DISC[tone],
      )}
    >
      <MaterialSymbol
        name={name}
        filled={name !== "progress_activity"}
        size={30}
        className={
          name === "progress_activity" ? "motion-safe:animate-spin" : undefined
        }
      />
    </span>
  );
}

/** Compact status node for the supporting step ledger. */
function StepNode({ status }: { status: ApplyStepStatus }) {
  const base =
    "flex size-5 shrink-0 items-center justify-center rounded-pill transition-colors duration-[var(--duration-standard)] ease-standard motion-reduce:transition-none";
  switch (status) {
    case "running":
      return (
        <span className={cn(base, "text-info")}>
          <MaterialSymbol
            name="progress_activity"
            size={18}
            className="motion-safe:animate-spin"
          />
        </span>
      );
    case "done":
      return (
        <span className={cn(base, "text-success")}>
          <MaterialSymbol name="check_circle" filled size={18} />
        </span>
      );
    case "failed":
      return (
        <span className={cn(base, "text-destructive")}>
          <MaterialSymbol name="cancel" filled size={18} />
        </span>
      );
    case "skipped":
      return (
        <span className={cn(base, "text-muted-foreground")}>
          <MaterialSymbol name="do_not_disturb_on" size={18} />
        </span>
      );
    default:
      return (
        <span className={cn(base, "text-muted-foreground/60")}>
          <MaterialSymbol name="schedule" size={16} />
        </span>
      );
  }
}

export function ApplyProgressDialog({
  open,
  onClose,
  applyState,
  error,
}: ApplyProgressDialogProps) {
  const { t } = useTranslation("cellular");

  const stepLabels = useMemo<Record<string, string>>(
    () => ({
      apn: t("custom_profiles.apply_dialog.step_labels.apn"),
      ttl_hl: t("custom_profiles.apply_dialog.step_labels.ttl_hl"),
      imei: t("custom_profiles.apply_dialog.step_labels.imei"),
      mpdn_rule: t("custom_profiles.apply_dialog.step_labels.mpdn_rule"),
    }),
    [t],
  );

  const status = applyState?.status ?? (open ? "applying" : "idle");
  const isTerminal = ["complete", "partial", "failed"].includes(status);
  const steps = applyState?.steps ?? (open ? DEFAULT_STEPS : []);

  const tone: Tone =
    status === "complete"
      ? "success"
      : status === "partial"
        ? "warning"
        : status === "failed"
          ? "destructive"
          : "info";

  const total = applyState?.total_steps || steps.length || 0;
  const doneCount = steps.filter((s) => isTraversed(s.status)).length;
  const dotCount = steps.length || total;

  // Headline + subtext: name the step in flight, or the terminal verdict.
  const runningStep = steps.find((s) => s.status === "running");
  const headline =
    status === "complete"
      ? t("custom_profiles.apply_dialog.complete_headline")
      : status === "partial"
        ? t("custom_profiles.apply_dialog.partial_headline")
        : status === "failed"
          ? t("custom_profiles.apply_dialog.failed_headline")
          : runningStep
            ? (stepLabels[runningStep.name] ?? runningStep.name)
            : t("custom_profiles.apply_dialog.preparing");

  const subtext =
    status === "complete"
      ? t("custom_profiles.apply_dialog.complete_sub")
      : status === "partial"
        ? t("custom_profiles.apply_dialog.partial_sub")
        : status === "failed"
          ? t("custom_profiles.apply_dialog.failed_sub")
          : runningStep && total > 0
            ? t("custom_profiles.apply_dialog.step_progress", {
                current: applyState?.current_step ?? doneCount + 1,
                total,
              })
            : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && isTerminal && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("custom_profiles.apply_dialog.title")}</DialogTitle>
          {applyState?.profile_name && (
            <DialogDescription>{applyState.profile_name}</DialogDescription>
          )}
        </DialogHeader>

        {/* Status hero — the single focal point. Text block reserves a fixed
            two-line height so advancing between steps doesn't resize the dialog. */}
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <HeroGlyph tone={tone} status={status} />
          <div className="flex min-h-[2.75rem] flex-col justify-center space-y-1">
            <p className="text-base font-semibold tracking-tight">{headline}</p>
            {subtext && (
              <p className="text-muted-foreground text-sm">{subtext}</p>
            )}
          </div>

          {/* Determinate fill: steps traversed over total, transform-only
              (scaleX). Kept over the Loader-and-Dots Rule for the same reason
              as the Config Restore pipeline (U4.11.6): it counts real steps,
              not elapsed time. */}
          {dotCount > 0 && (
            <div
              role="img"
              aria-label={t("custom_profiles.apply_dialog.step_progress", {
                current: Math.min(
                  applyState?.current_step ?? doneCount + 1,
                  dotCount,
                ),
                total: dotCount,
              })}
              className="relative h-1.5 w-full overflow-hidden rounded-pill bg-surface-container-high"
            >
              <motion.div
                className={cn("h-full w-full origin-left rounded-pill", TONE_FILL[tone])}
                initial={false}
                animate={{ scaleX: Math.min(doneCount / dotCount, 1) }}
                transition={transitionStandard}
              />
            </div>
          )}
        </div>

        {/* Supporting ledger — compact per-step detail. */}
        {steps.length > 0 && (
          <div className="rounded-card bg-surface-container">
            <p className="text-muted-foreground px-3 pt-2.5 pb-1 text-xs font-medium">
              {t("custom_profiles.apply_dialog.details_label")}
            </p>
            <ul>
              {steps.map((step) => {
                const eff = effectiveStatus(step.status, applyState?.status);
                const detailText =
                  eff === "skipped"
                    ? t("custom_profiles.apply_dialog.step_state_unchanged")
                    : step.detail;
                return (
                  <li
                    key={step.name}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 transition-colors duration-[var(--duration-standard)] ease-standard motion-reduce:transition-none",
                      eff === "running" && "bg-surface-container-high",
                    )}
                  >
                    <StepNode status={eff} />
                    <span
                      className={cn(
                        "flex-1 text-sm font-medium",
                        eff === "pending" && "text-muted-foreground",
                      )}
                    >
                      {stepLabels[step.name] ?? step.name}
                    </span>
                    {detailText && (
                      <span className="text-muted-foreground max-w-[45%] truncate text-xs">
                        {detailText}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Reboot notice — deferred, never an inline reboot. */}
        {applyState?.requires_reboot && (
          <div className="bg-info-container text-on-info-container flex items-start gap-2 rounded-card p-3 text-sm">
            <MaterialSymbol name="restart_alt" size={18} className="mt-0.5 shrink-0" />
            <p>{t("custom_profiles.apply_dialog.reboot_notice")}</p>
          </div>
        )}

        {/* Error from the start request (not step-level) */}
        {error && !applyState && (
          <div className="bg-destructive-container text-on-destructive-container flex items-start gap-2 rounded-card p-3 text-sm">
            <MaterialSymbol name="warning" size={18} className="mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Partial / failed summary */}
        {applyState?.status === "partial" && applyState.error && (
          <div className="bg-warning-container text-on-warning-container rounded-card p-3 text-sm">
            {resolveErrorMessage(t, applyState.error, undefined, applyState.error)}
          </div>
        )}
        {applyState?.status === "failed" && applyState.error && (
          <div className="bg-destructive-container text-on-destructive-container rounded-card p-3 text-sm">
            {resolveErrorMessage(t, applyState.error, undefined, applyState.error)}
          </div>
        )}

        {/* Footer — height reserved (min-h) so the button appearing at a terminal
            state doesn't resize the dialog. Button renders only when actionable. */}
        <div className="flex min-h-9 justify-end">
          {(isTerminal || (error && !applyState)) && (
            <Button variant="ghost" onClick={onClose}>
              {t("actions.close", { ns: "common" })}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
