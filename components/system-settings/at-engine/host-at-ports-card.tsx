"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  CableIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleOffIcon,
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
import { cn } from "@/lib/utils";

import { useHostAtPorts } from "@/hooks/use-host-at-ports";

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
// Host AT Ports — USB/PCIe host access to the modem's AT engine
// =============================================================================
// QManager never uses these ports (its own path is internal), so turning them
// off never affects the UI or the cellular connection. It only stops an
// attached computer from sending AT commands. That consequence stays visible
// on the row (Principle 6), never behind a tip.
//
// Same anatomy as Hardware Offload, its row-mate on /system-settings/hardware:
// a decision row, a status row, then the footer. Change one, change both.
// =============================================================================

const K = "host_at";

type Choice = "on" | "off";

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

function HostAtHeader() {
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

function HostAtSkeleton() {
  return (
    <Card className={CARD_SHELL} aria-hidden="true">
      <HostAtHeader />
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <div className={cn(ROW_GROUP, GROUP_FILL)}>
          <div className={ROW.ROOT}>
            <div className={ROW.TEXT}>
              <Skeleton className={cn(SKELETON_HARDWARE.LABEL, "w-28")} />
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

const HostAtPortsCard = () => {
  const { t } = useTranslation("system-settings");
  const { state, isLoading, isSaving, setEnabled, refresh } = useHostAtPorts();
  const { saved, markSaved } = useSaveFlash();

  const savedChoice: Choice | null = state ? (state.enabled ? "on" : "off") : null;
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
      markSaved();
      toast.success(draft === "on" ? t(`${K}.toast_on`) : t(`${K}.toast_off`));
    } else {
      toast.error(result.error ?? t(`${K}.toast_failed`));
    }
  };

  if (isLoading && state === null) return <HostAtSkeleton />;

  if (state === null) {
    return (
      <Card className={CARD_SHELL}>
        <HostAtHeader />
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
        <HostAtHeader />
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <ConditionBlock
            tone="neutral"
            glyph={CableIcon}
            ariaRole="status"
            title={t(`${K}.unavailable_title`)}
            description={t(`${K}.unavailable`)}
            className={CONDITION_PANEL.SCREEN}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={CARD_SHELL}>
      <HostAtHeader />
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
              <span className={ROW.LABEL}>{t(`${K}.access_label`)}</span>
              <span className={ROW.CONSEQUENCE}>
                {state.pcie
                  ? t(`${K}.consequence_pcie`)
                  : t(`${K}.consequence_usb`)}
              </span>
            </div>
            <div className={ROW.CONTROL}>
              <SegmentedField<Choice>
                value={draft ?? "off"}
                onValueChange={setDraft}
                options={[
                  { value: "off", label: t("state.off", { ns: "common" }) },
                  { value: "on", label: t("state.on", { ns: "common" }) },
                ]}
                ariaLabel={t(`${K}.access_label`)}
                disabled={isSaving}
                breakpoint="never"
                glyph={renderCheckGlyph}
              />
            </div>
          </motion.div>

          <motion.div variants={staggerRowItem} className={STATUS_ROW}>
            <span className={ROW.LABEL}>{t(`${K}.status_label`)}</span>
            {state.running ? (
              <Badge variant="success">
                <CircleCheckIcon className={CHIP_GLYPH} aria-hidden="true" />
                {t(`${K}.status_active`)}
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

export default HostAtPortsCard;
