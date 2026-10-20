"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleOffIcon,
  CpuIcon,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { requestRebootLater, usePendingReboot } from "@/lib/reboot";
import { cn } from "@/lib/utils";

import { useIpaOffload } from "@/hooks/use-ipa-offload";

import { ConditionBlock } from "../condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHIP_GLYPH,
  CONDITION_PANEL,
  GROUP_FILL,
  ROW,
  ROW_GROUP,
  SKELETON_HARDWARE,
  STATUS_ROW,
} from "../shapes";

// =============================================================================
// Hardware Offload — the r8125 NIC's IPA offload path, armed for next boot
// =============================================================================
// The backend only flips the boot-enable state; the module stays loaded until
// the next reboot. So Apply never reboots: on success it arms the persistent
// deferred-reboot banner (`requestRebootLater("ipa_offload")`) and toasts.
//
// The status row is honest about that split. `enabled` is the BOOT state, so
// while this card's own reboot is still pending the row says so rather than
// claiming the new state is already running.
// =============================================================================

const K = "ipa_offload";

type Choice = "on" | "off";

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

function OffloadHeader() {
  const { t } = useTranslation("system-settings");
  return (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t(`${K}.card_title`)}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t(`${K}.card_description`)}
      </CardDescription>
    </CardHeader>
  );
}

function OffloadSkeleton() {
  return (
    <Card className={CARD_SHELL} aria-hidden="true">
      <OffloadHeader />
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <div className={cn(ROW_GROUP, GROUP_FILL)}>
          <div className={ROW.ROOT}>
            <div className={ROW.TEXT}>
              <Skeleton className={cn(SKELETON_HARDWARE.LABEL, "w-36")} />
              <Skeleton className={cn(SKELETON_HARDWARE.CONSEQUENCE, "w-full")} />
            </div>
            <div className={ROW.CONTROL}>
              <Skeleton className={SKELETON_HARDWARE.PILL} />
            </div>
          </div>
          <div className={STATUS_ROW}>
            <Skeleton className={cn(SKELETON_HARDWARE.LABEL, "w-16")} />
            <Skeleton className={SKELETON_HARDWARE.CHIP} />
          </div>
        </div>
        <CardFoot
          liveStatus={false}
          actions={<Skeleton className={SKELETON_HARDWARE.ACTION} />}
        />
      </CardContent>
    </Card>
  );
}

const IpaOffloadCard = () => {
  const { t } = useTranslation("system-settings");
  const { state, isLoading, isSaving, setEnabled, refresh } = useIpaOffload();
  const { saved, markSaved } = useSaveFlash();
  const pendingReboot = usePendingReboot();

  const savedChoice: Choice | null = state
    ? state.enabled
      ? "on"
      : "off"
    : null;
  const [draft, setDraft] = useState<Choice | null>(null);
  const [seen, setSeen] = useState<Choice | null>(null);
  if (savedChoice !== seen) {
    setSeen(savedChoice);
    setDraft(savedChoice);
  }

  const dirty = draft !== null && savedChoice !== null && draft !== savedChoice;

  const handleApply = async () => {
    if (!draft || !dirty) return;
    const result = await setEnabled(draft === "on");
    if (result.ok) {
      // The change only takes effect after a reboot, so queue the deferred banner.
      requestRebootLater("ipa_offload");
      markSaved();
      toast.success(
        draft === "on" ? t(`${K}.toast_enabled`) : t(`${K}.toast_disabled`),
      );
    } else {
      toast.error(result.error ?? t(`${K}.toast_failed`));
    }
  };

  if (isLoading && state === null) return <OffloadSkeleton />;

  if (state === null) {
    return (
      <Card className={CARD_SHELL}>
        <OffloadHeader />
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <ConditionBlock
            tone="destructive"
            glyph={CircleAlertIcon}
            ariaRole="alert"
            title={t(`${K}.error_title`)}
            description={t(`${K}.error_description`)}
            onRetry={refresh}
            retryLabel={t("actions.retry", { ns: "common" })}
            className={CONDITION_PANEL.SCREEN}
          />
        </CardContent>
      </Card>
    );
  }

  if (!state.available) {
    return (
      <Card className={CARD_SHELL}>
        <OffloadHeader />
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <ConditionBlock
            tone="neutral"
            glyph={CpuIcon}
            ariaRole="status"
            title={t(`${K}.unavailable_title`)}
            description={t(`${K}.unavailable_hint`)}
            className={CONDITION_PANEL.SCREEN}
          />
        </CardContent>
      </Card>
    );
  }

  const rebootPending = pendingReboot?.source === "ipa_offload";

  return (
    <Card className={CARD_SHELL}>
      <OffloadHeader />
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {/* Declared here and not inherited: the card swaps in after its
            skeleton, once the page cascade has already run. */}
        <motion.div
          className={cn(ROW_GROUP, GROUP_FILL)}
          variants={staggerRows}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={staggerRowItem} className={ROW.ROOT}>
            <div className={ROW.TEXT}>
              <span className={ROW.LABEL}>{t(`${K}.enable_label`)}</span>
              <span className={ROW.CONSEQUENCE}>{t(`${K}.cpu_warning`)}</span>
            </div>
            <div className={ROW.CONTROL}>
              <SegmentedField<Choice>
                value={draft ?? "off"}
                onValueChange={setDraft}
                options={[
                  { value: "off", label: t("state.off", { ns: "common" }) },
                  { value: "on", label: t("state.on", { ns: "common" }) },
                ]}
                ariaLabel={t(`${K}.enable_label`)}
                disabled={isSaving}
                breakpoint="never"
                glyph={renderCheckGlyph}
              />
            </div>
          </motion.div>

          <motion.div variants={staggerRowItem} className={STATUS_ROW}>
            <span className={ROW.LABEL}>{t(`${K}.status_label`)}</span>
            {rebootPending ? (
              <Badge variant="warning">
                <RotateCcwIcon className={CHIP_GLYPH} aria-hidden="true" />
                {t(`${K}.pending_reboot_badge`)}
              </Badge>
            ) : state.enabled ? (
              <Badge variant="success">
                <CircleCheckIcon className={CHIP_GLYPH} aria-hidden="true" />
                {t(`${K}.status_on`)}
              </Badge>
            ) : (
              <Badge variant="muted">
                <CircleOffIcon className={CHIP_GLYPH} aria-hidden="true" />
                {t(`${K}.status_off`)}
              </Badge>
            )}
          </motion.div>
        </motion.div>

        <CardFoot
          status={<span>{t(`${K}.reboot_note`)}</span>}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="action"
                onClick={() => setDraft(savedChoice)}
                disabled={!dirty || isSaving}
              >
                {t("actions.discard", { ns: "common" })}
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
      </CardContent>
    </Card>
  );
};

export default IpaOffloadCard;
