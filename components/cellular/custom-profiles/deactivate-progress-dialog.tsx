"use client";

import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

// =============================================================================
// DeactivateProgressDialog — confirm, then STAY OPEN for the whole request
// =============================================================================
// `deactivate.sh` is one blocking request with no status endpoint: it reverts
// the Verizon MPDN rule when needed, clears the active marker, tears down the
// scenario schedule and restores the saved APN. So this dialog honestly shows
// only "confirm" and "in flight" — no invented step list. The coordinator
// toasts the outcome; the dialog closes when the request resolves and never
// reports a verdict itself.
// =============================================================================

const DIALOG_DISC = "grid size-14 flex-none place-items-center rounded-pill";

export type DeactivatePhase = "confirm" | "working";

export interface DeactivateProgressDialogProps {
  open: boolean;
  phase: DeactivatePhase;
  /** The profile being deactivated, for the description line. */
  profileName?: string;
  /** Verizon profiles revert the data routing rule and need a reboot. */
  isVerizon?: boolean;
  /** Fires the request. The caller flips `phase` to "working". */
  onConfirm: () => void;
  /** Dismissal; refused while the request is in flight. */
  onOpenChange: (open: boolean) => void;
}

export function DeactivateProgressDialog({
  open,
  phase,
  profileName,
  isVerizon = false,
  onConfirm,
  onOpenChange,
}: DeactivateProgressDialogProps) {
  const { t } = useTranslation("cellular");
  const { t: tc } = useTranslation("common");

  const working = phase === "working";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && working) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="overflow-hidden rounded-card sm:max-w-md"
        showCloseButton={!working}
        // Radix's `onOpenChange` guard above already refuses the close; these
        // cancel the gesture at source so an outside click mid-request does not
        // bounce focus out of the dialog on its way to being ignored.
        onInteractOutside={(e) => {
          if (working) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (working) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {working
              ? t("custom_profiles.deactivate_dialog.working_title")
              : t("custom_profiles.deactivate_dialog.title")}
          </DialogTitle>
          {/* Always rendered — an omitted DialogDescription leaves the Radix
              dialog without an accessible description. */}
          <DialogDescription>
            {profileName ||
              t("custom_profiles.deactivate_dialog.unknown_profile")}
          </DialogDescription>
        </DialogHeader>

        {/* The disc persists across both phases and only its glyph changes,
            so confirming reads as the same object continuing. */}
        <div className="flex flex-col items-center gap-3 py-1 text-center">
          <span
            className={cn(DIALOG_DISC, "bg-primary text-primary-foreground")}
          >
            <MaterialSymbol
              name={working ? "progress_activity" : "power_settings_new"}
              filled
              size={28}
              className={cn(working && "motion-safe:animate-spin")}
            />
          </span>

          {/* The text block reserves a floor so swapping phase does not resize
              the dialog under the pointer. */}
          <div
            className="flex min-h-[5.5rem] flex-col justify-center gap-1.5"
            aria-live="polite"
          >
            <p className="text-base leading-tight font-semibold tracking-tight text-balance">
              {working
                ? t("custom_profiles.deactivate_dialog.working_headline")
                : t("custom_profiles.deactivate_dialog.confirm_headline")}
            </p>
            <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
              {working
                ? t("custom_profiles.deactivate_dialog.working_sub")
                : t("custom_profiles.deactivate_dialog.description")}
            </p>
            {isVerizon && !working ? (
              <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
                {t("custom_profiles.deactivate_dialog.verizon_note")}
              </p>
            ) : null}
          </div>
        </div>

        {/* Height reserved so the row emptying out does not resize the
            dialog; the request cannot be cancelled, so nothing renders. */}
        <div className="flex min-h-10 items-center justify-end gap-2">
          {working ? null : (
            <>
              <Button
                variant="tonal"
                size="action"
                onClick={() => onOpenChange(false)}
              >
                {tc("actions.cancel")}
              </Button>
              <Button size="action" onClick={onConfirm}>
                <MaterialSymbol name="power_settings_new" size={16} />
                {t("custom_profiles.deactivate_dialog.confirm")}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default DeactivateProgressDialog;
