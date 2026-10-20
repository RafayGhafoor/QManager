"use client";

import React from "react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ProfileInputComponent, {
  type ProfileSaveOutcome,
  type WizardTab,
} from "@/components/cellular/custom-profiles/profile-input";
import type { UseCurrentSettingsReturn } from "@/hooks/use-current-settings";
import type { UseSimProfilesReturn } from "@/hooks/use-sim-profiles";

// =============================================================================
// ProfileFormDialog — the create/edit wizard, hosted in a dialog
// =============================================================================
// The wizard (`profile-input.tsx`) owns the five-step flow, its validation, the
// Verizon brick warning and CID lock, its toasts and its CardFoot. This file
// only hosts it.
//
// WHY THE DIALOG IS UNPADDED AND ITS HEADER IS SCREEN-READER ONLY.
// The wizard renders its own `<Card>` with a header that already carries the
// create/edit title. A second visible `DialogHeader` would double-frame it, but
// Radix requires an accessible name and description, so the dialog keeps them
// `sr-only` and the wizard's header stays the single visible one.
//
// The body scrolls inside an `85dvh` cap, so the wizard's tab strip and
// CardFoot stay reachable on a landscape tablet with a collapsing URL bar.
// =============================================================================

interface ProfileFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sim: UseSimProfilesReturn;
  currentSettings: UseCurrentSettingsReturn;
  /** null = new profile, otherwise the id being edited. */
  editingId: string | null;
  /** A successful save; the dialog closes itself first. */
  onSaved: (outcome: ProfileSaveOutcome) => void;
  /** Which wizard step to open on ("scenario" from Edit schedule). */
  initialTab?: WizardTab;
  /** "+ Create scenario" picked in the wizard's default-scenario Select. */
  onCreateScenario?: () => void;
}

export function ProfileFormDialog({
  open,
  onOpenChange,
  sim,
  currentSettings,
  editingId,
  onSaved,
  initialTab,
  onCreateScenario,
}: ProfileFormDialogProps) {
  const { t } = useTranslation("cellular");
  const isEditing = editingId !== null;

  // The wizard only calls onDone after the profile landed on the device, so
  // closing here never destroys the only copy of what the user typed. A failed
  // save toasts inside the wizard and leaves the dialog open for a retry.
  const handleDone = (outcome: ProfileSaveOutcome) => {
    onOpenChange(false);
    onSaved(outcome);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] w-full max-w-3xl gap-0 overflow-hidden rounded-card p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>
            {isEditing
              ? t("custom_profiles.form.edit_title")
              : t("custom_profiles.form.add_title")}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? t("custom_profiles.form.edit_description_simple")
              : t("custom_profiles.form.add_description")}
          </DialogDescription>
        </DialogHeader>

        {/* The scroll container. `[&>[data-slot=card]]` drops the wizard Card's
            fill, hairline, sheen (background-image) and shadow so the dialog
            is the one panel the user reads; its layout and children stay. */}
        <div className="max-h-[85dvh] overflow-y-auto overscroll-contain [scrollbar-width:thin] [&>[data-slot=card]]:border-0 [&>[data-slot=card]]:bg-transparent [&>[data-slot=card]]:bg-none [&>[data-slot=card]]:shadow-none">
          {/* Radix unmounts the content when closed, so every open starts a
              fresh draft; the key also resets it when the target changes. */}
          <ProfileInputComponent
            key={editingId ?? "new"}
            sim={sim}
            currentSettings={currentSettings}
            editingId={editingId}
            onDone={handleDone}
            onCancel={() => onOpenChange(false)}
            initialTab={initialTab}
            onCreateScenario={onCreateScenario}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ProfileFormDialog;
