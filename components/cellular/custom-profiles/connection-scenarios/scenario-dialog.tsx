"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SaveButton } from "@/components/ui/save-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// =============================================================================
// ScenarioDialog — ONE dialog for adding and editing a custom scenario
// =============================================================================
// Replaces the two near-identical Add / Edit dialogs. No theme picker: the page
// draws no gradients. The draft is seeded once per open from `initial` (the
// parent remounts this component per open through its `key`).
// =============================================================================

export interface ScenarioDraft {
  name: string;
  description: string;
  mode: string;
  optimization: string;
  lteBands: string;
  saBands: string;
  nsaBands: string;
}

export const EMPTY_SCENARIO_DRAFT: ScenarioDraft = {
  name: "",
  description: "",
  mode: "AUTO",
  optimization: "",
  lteBands: "",
  saBands: "",
  nsaBands: "",
};

interface ScenarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "add" for a new scenario, "edit" for an existing custom one. */
  mode: "add" | "edit";
  initial: ScenarioDraft;
  modeOptions: { value: string; label: string }[];
  isSaving: boolean;
  onSubmit: (draft: ScenarioDraft) => void;
}

export function ScenarioDialog({
  open,
  onOpenChange,
  mode,
  initial,
  modeOptions,
  isSaving,
  onSubmit,
}: ScenarioDialogProps) {
  const { t } = useTranslation("cellular");
  const F = "scenarios.add_dialog.fields";
  const [draft, setDraft] = useState<ScenarioDraft>(initial);
  const [attempted, setAttempted] = useState(false);
  const nameMissing = !draft.name.trim();

  const set = (key: keyof ScenarioDraft) => (value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (nameMissing || isSaving) return;
    onSubmit(draft);
  };

  const formId = `scenario-dialog-${mode}`;

  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "add"
              ? t("scenarios.add_dialog.title")
              : t("scenarios.edit_dialog.title")}
          </DialogTitle>
          <DialogDescription>{t("scenarios.dialog.description")}</DialogDescription>
        </DialogHeader>

        <form id={formId} onSubmit={handleSubmit}>
          <FieldGroup className="gap-5">
            <Field data-invalid={attempted && nameMissing ? true : undefined}>
              <FieldLabel htmlFor={`${formId}-name`}>{t(`${F}.name_label`)}</FieldLabel>
              <Input
                id={`${formId}-name`}
                value={draft.name}
                onChange={(e) => set("name")(e.target.value)}
                placeholder={t(`${F}.name_placeholder`)}
                aria-invalid={attempted && nameMissing}
              />
              {attempted && nameMissing ? (
                <FieldError>{t("scenarios.dialog.name_required")}</FieldError>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor={`${formId}-description`}>
                {t(`${F}.description_label`)}
              </FieldLabel>
              <Input
                id={`${formId}-description`}
                value={draft.description}
                onChange={(e) => set("description")(e.target.value)}
                placeholder={t(`${F}.description_placeholder`)}
              />
            </Field>

            <Field>
              <FieldLabel>{t(`${F}.network_mode_label`)}</FieldLabel>
              <Select value={draft.mode} onValueChange={set("mode")}>
                <SelectTrigger aria-label={t(`${F}.network_mode_aria`)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {mode === "edit" ? (
              <Field>
                <FieldLabel htmlFor={`${formId}-optimization`}>
                  {t("scenarios.edit_dialog.fields.optimization_label")}
                </FieldLabel>
                <Input
                  id={`${formId}-optimization`}
                  value={draft.optimization}
                  onChange={(e) => set("optimization")(e.target.value)}
                  placeholder={t("scenarios.edit_dialog.fields.optimization_placeholder")}
                />
              </Field>
            ) : null}

            <Field>
              <FieldLabel htmlFor={`${formId}-lte`}>{t(`${F}.lte_bands_label`)}</FieldLabel>
              <Input
                id={`${formId}-lte`}
                inputMode="numeric"
                className="tabular-nums"
                value={draft.lteBands}
                onChange={(e) => set("lteBands")(e.target.value)}
                placeholder={t(`${F}.lte_bands_placeholder`)}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${formId}-sa`}>{t(`${F}.sa_bands_label`)}</FieldLabel>
                <Input
                  id={`${formId}-sa`}
                  inputMode="numeric"
                  className="tabular-nums"
                  value={draft.saBands}
                  onChange={(e) => set("saBands")(e.target.value)}
                  placeholder={t(`${F}.sa_bands_placeholder`)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${formId}-nsa`}>{t(`${F}.nsa_bands_label`)}</FieldLabel>
                <Input
                  id={`${formId}-nsa`}
                  inputMode="numeric"
                  className="tabular-nums"
                  value={draft.nsaBands}
                  onChange={(e) => set("nsaBands")(e.target.value)}
                  placeholder={t(`${F}.nsa_bands_placeholder`)}
                />
              </Field>
            </div>
          </FieldGroup>
        </form>

        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="ghost" disabled={isSaving}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
          </DialogClose>
          <SaveButton
            type="submit"
            form={formId}
            isSaving={isSaving}
            saved={false}
            label={
              mode === "add"
                ? t("scenarios.add_dialog.buttons.create")
                : t("scenarios.edit_dialog.buttons.save")
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ScenarioDialog;
