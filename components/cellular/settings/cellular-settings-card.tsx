"use client";

import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { CardFoot } from "@/components/ui/card-foot";
import type { CellularSettings } from "@/types/cellular-settings";

interface CellularSettingsCardProps {
  settings: CellularSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (changes: Partial<CellularSettings>) => Promise<boolean>;
}

const CellularSettingsCard = ({
  settings,
  isLoading,
  isSaving,
  onSave,
}: CellularSettingsCardProps) => {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();
  const formId = useId();
  const [simSlot, setSimSlot] = useState<string>("");
  const [cfun, setCfun] = useState<string>("");
  const [modePref, setModePref] = useState<string>("");
  const [nr5gMode, setNr5gMode] = useState<string>("");
  const [roamPref, setRoamPref] = useState<string>("");

  // Seed local form state from fetched settings using the render-phase
  // derived-state pattern (React docs: "You Might Not Need an Effect") instead of
  // useEffect, so the sync lands in the same commit. prevSettings keeps it to one
  // sync per source-reference change — identical semantics to the prior [settings]
  // effect.
  const [prevSettings, setPrevSettings] = useState(settings);
  if (settings && settings !== prevSettings) {
    setPrevSettings(settings);
    setSimSlot(String(settings.sim_slot));
    setCfun(String(settings.cfun));
    setModePref(settings.mode_pref);
    setNr5gMode(String(settings.nr5g_mode));
    setRoamPref(String(settings.roam_pref));
  }

  const isDirty =
    settings !== null &&
    (Number(simSlot) !== settings.sim_slot ||
      Number(cfun) !== settings.cfun ||
      modePref !== settings.mode_pref ||
      Number(nr5gMode) !== settings.nr5g_mode ||
      Number(roamPref) !== settings.roam_pref);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    const changes: Partial<CellularSettings> = {};

    if (Number(simSlot) !== settings.sim_slot) {
      changes.sim_slot = Number(simSlot);
    }
    if (Number(cfun) !== settings.cfun) {
      changes.cfun = Number(cfun);
    }
    if (modePref !== settings.mode_pref) {
      changes.mode_pref = modePref;
    }
    if (Number(nr5gMode) !== settings.nr5g_mode) {
      changes.nr5g_mode = Number(nr5gMode);
    }
    if (Number(roamPref) !== settings.roam_pref) {
      changes.roam_pref = Number(roamPref);
    }

    if (Object.keys(changes).length === 0) {
      toast.info(t("core_settings.basic.radio.toast.no_changes"));
      return;
    }

    const success = await onSave(changes);
    if (success) {
      markSaved();
      toast.success(t("core_settings.basic.radio.toast.success"));
    } else {
      toast.error(t("core_settings.basic.radio.toast.error"));
    }
  };

  const handleReset = () => {
    if (settings) {
      setSimSlot(String(settings.sim_slot));
      setCfun(String(settings.cfun));
      setModePref(settings.mode_pref);
      setNr5gMode(String(settings.nr5g_mode));
      setRoamPref(String(settings.roam_pref));
    }
  };

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("core_settings.basic.radio.card.title")}</CardTitle>
          <CardDescription>
            {t("core_settings.basic.radio.card.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
            <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
            <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          </div>
        </CardContent>
        <CardFoot
          className="px-6"
          liveStatus={false}
          aria-hidden="true"
          actions={<Skeleton className="h-[2.625rem] w-40 rounded-pill" />}
        />
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("core_settings.basic.radio.card.title")}</CardTitle>
        <CardDescription>
          {t("core_settings.basic.radio.card.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id={formId} className="grid gap-4" onSubmit={handleSave}>
          <div className="w-full">
            <FieldSet>
              <FieldGroup>
                <div className="grid @md/card:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  <Field>
                    <FieldLabel>{t("core_settings.basic.radio.sim_slot.label")}</FieldLabel>
                    <Select
                      value={simSlot || (settings ? String(settings.sim_slot) : "")}
                      onValueChange={setSimSlot}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("core_settings.basic.radio.sim_slot.placeholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">{t("core_settings.basic.radio.sim_slot.options.sim1")}</SelectItem>
                        <SelectItem value="2">{t("core_settings.basic.radio.sim_slot.options.sim2")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel>{t("core_settings.basic.radio.radio_power.label")}</FieldLabel>
                    <Select
                      value={cfun || (settings ? String(settings.cfun) : "")}
                      onValueChange={setCfun}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("core_settings.basic.radio.radio_power.placeholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">{t("core_settings.basic.radio.radio_power.options.low_power")}</SelectItem>
                        <SelectItem value="1">{t("core_settings.basic.radio.radio_power.options.normal")}</SelectItem>
                        <SelectItem value="4">
                          {t("core_settings.basic.radio.radio_power.options.airplane")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <div className="grid @md/card:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  <Field>
                    <FieldLabel>{t("core_settings.basic.radio.network_type.label")}</FieldLabel>
                    <Select
                      value={modePref || (settings ? settings.mode_pref : "")}
                      onValueChange={setModePref}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("core_settings.basic.radio.network_type.placeholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AUTO">{t("core_settings.basic.radio.network_type.options.auto")}</SelectItem>
                        <SelectItem value="LTE">{t("core_settings.basic.radio.network_type.options.lte")}</SelectItem>
                        <SelectItem value="NR5G">{t("core_settings.basic.radio.network_type.options.nr5g")}</SelectItem>
                        <SelectItem value="LTE:NR5G">{t("core_settings.basic.radio.network_type.options.lte_nr5g")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel>{t("core_settings.basic.radio.architecture.label")}</FieldLabel>
                    <Select
                      value={nr5gMode || (settings ? String(settings.nr5g_mode) : "")}
                      onValueChange={setNr5gMode}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("core_settings.basic.radio.architecture.placeholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">{t("core_settings.basic.radio.architecture.options.auto")}</SelectItem>
                        <SelectItem value="1">{t("core_settings.basic.radio.architecture.options.nsa")}</SelectItem>
                        <SelectItem value="2">{t("core_settings.basic.radio.architecture.options.sa")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <div className="grid @md/card:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  <Field>
                    <FieldLabel>{t("core_settings.basic.radio.roaming.label")}</FieldLabel>
                    <Select
                      value={roamPref || (settings ? String(settings.roam_pref) : "")}
                      onValueChange={setRoamPref}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("core_settings.basic.radio.roaming.placeholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="255">{t("core_settings.basic.radio.roaming.options.any")}</SelectItem>
                        <SelectItem value="1">{t("core_settings.basic.radio.roaming.options.home")}</SelectItem>
                        <SelectItem value="3">{t("core_settings.basic.radio.roaming.options.partner")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </FieldGroup>
            </FieldSet>
          </div>
        </form>
      </CardContent>
      <CardFoot
        className="px-6"
        status={
          isDirty ? (
            <span className="font-medium">{t("common:state.unsaved")}</span>
          ) : null
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={handleReset}
              disabled={!isDirty || isSaving}
            >
              {t("common:actions.discard")}
            </Button>
            <SaveButton
              type="submit"
              form={formId}
              isSaving={isSaving}
              saved={saved}
              disabled={!isDirty}
              size="action"
            />
          </>
        }
      />
    </Card>
  );
};

export default CellularSettingsCard;
