"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  AlertTriangleIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleOffIcon,
  RotateCcwIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { SegmentedField } from "@/components/ui/segmented-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { staggerRows, staggerRowItem } from "@/lib/motion";

import { useHostAtPorts } from "@/hooks/use-host-at-ports";
import { SETTING_ROW, SettingRow } from "./setting-row";

// =============================================================================
// Host AT Ports — USB/PCIe host access to the modem's AT engine
// =============================================================================
// QManager never uses these ports (its own path is internal), so turning them
// off never affects the UI or the cellular connection. It only stops an
// attached computer from sending AT commands. That consequence stays visible
// on the card while Off is selected (Principle 6), never behind a tip.
// =============================================================================

type Choice = "on" | "off";

const HostAtPortsCard = () => {
  const { t } = useTranslation("system-settings");
  const { state, isLoading, isSaving, error, setEnabled, refresh } = useHostAtPorts();
  const { saved, markSaved } = useSaveFlash();

  const savedChoice: Choice | null = state ? (state.enabled ? "on" : "off") : null;
  const [draft, setDraft] = useState<Choice | null>(null);
  const [seen, setSeen] = useState<Choice | null>(null);
  if (savedChoice !== seen) {
    setSeen(savedChoice);
    setDraft(savedChoice);
  }

  const dirty = draft !== null && savedChoice !== null && draft !== savedChoice;
  const unavailable = state !== null && !state.available;

  const handleApply = async () => {
    if (!draft || !dirty) return;
    const result = await setEnabled(draft === "on");
    if (result.ok) {
      markSaved();
      toast.success(
        draft === "on" ? t("host_at.toast_on") : t("host_at.toast_off"),
      );
    } else {
      toast.error(result.error ?? t("host_at.toast_failed"));
    }
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("host_at.card_title")}</CardTitle>
        <CardDescription>{t("host_at.card_description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-2">
            <div className={SETTING_ROW}>
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-[2.625rem] w-36 rounded-pill" />
            </div>
            <div className={SETTING_ROW}>
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-6 w-20 rounded-pill" />
            </div>
          </div>
        ) : error && state === null ? (
          <div className="grid gap-3">
            <Alert variant="destructive">
              <AlertTriangleIcon className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button variant="tonal-neutral" onClick={refresh} className="w-fit">
              <RotateCcwIcon className="size-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          </div>
        ) : state && draft ? (
          <motion.div
            className="grid gap-2"
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            <motion.div variants={staggerRowItem}>
              <SettingRow label={t("host_at.access_label")}>
                <SegmentedField<Choice>
                  value={draft}
                  onValueChange={setDraft}
                  ariaLabel={t("host_at.access_label")}
                  breakpoint="never"
                  disabled={isSaving || unavailable}
                  options={[
                    { value: "on", label: t("state.on", { ns: "common" }) },
                    { value: "off", label: t("state.off", { ns: "common" }) },
                  ]}
                  glyph={(className) => (
                    <CheckIcon className={className} size={16} aria-hidden="true" />
                  )}
                />
              </SettingRow>
            </motion.div>

            {unavailable ? (
              <motion.p
                variants={staggerRowItem}
                className="text-sm text-muted-foreground"
              >
                {t("host_at.unavailable")}
              </motion.p>
            ) : draft === "off" ? (
              <motion.p
                variants={staggerRowItem}
                className="text-sm text-muted-foreground"
              >
                {state.pcie
                  ? t("host_at.consequence_pcie")
                  : t("host_at.consequence_usb")}
              </motion.p>
            ) : null}

            {!unavailable && (
              <motion.div variants={staggerRowItem}>
                <SettingRow label={t("host_at.status_label")}>
                  {state.running ? (
                    <Badge variant="success">
                      <CircleCheckIcon className="size-3" aria-hidden="true" />
                      {t("host_at.status_active")}
                    </Badge>
                  ) : (
                    <Badge variant="muted">
                      <CircleOffIcon className="size-3" aria-hidden="true" />
                      {t("host_at.status_off")}
                    </Badge>
                  )}
                </SettingRow>
              </motion.div>
            )}
          </motion.div>
        ) : null}
      </CardContent>

      {state && !unavailable && (
        <CardFoot
          className="px-6"
          actions={
            <>
              <Button
                type="button"
                variant="tonal-neutral"
                size="action"
                onClick={() => setDraft(savedChoice)}
                disabled={!dirty || isSaving}
              >
                {t("host_at.discard")}
              </Button>
              <SaveButton
                onClick={handleApply}
                isSaving={isSaving}
                saved={saved}
                label={t("actions.apply", { ns: "common" })}
                disabled={!dirty}
                size="action"
              />
            </>
          }
        />
      )}
    </Card>
  );
};

export default HostAtPortsCard;
