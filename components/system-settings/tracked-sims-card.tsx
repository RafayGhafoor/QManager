"use client";

import { useCallback, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { CardSimIcon, CircleAlertIcon, Loader2Icon, Trash2Icon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { UseKnownSimsReturn } from "@/hooks/use-known-sims";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION_PANEL,
  GROUP_FILL,
  PILL_GLYPH,
  ROW,
  ROW_GROUP,
  SKELETON,
  VALUE,
} from "./shapes";

// =============================================================================
// Tracked SIMs — the set of SIMs the device will not flag as new
// =============================================================================
// The device keeps a membership set, not a list: it can say HOW MANY SIMs it
// remembers, and forget them, but it cannot name them. So the card is one row
// holding the count, and a Clear that keeps the inserted SIM.
//
// `count === null` is a failed read and `0` is a genuine empty set. They get
// different screens: rendering the unknown as a zero would assert a fact.
// =============================================================================

const K = "known_sims";

type TrackedSimsCardProps = Pick<
  UseKnownSimsReturn,
  "count" | "isLoading" | "isClearing" | "refresh" | "clear"
>;

export default function TrackedSimsCard({
  count,
  isLoading,
  isClearing,
  refresh,
  clear,
}: TrackedSimsCardProps) {
  const { t } = useTranslation("system-settings");
  const [open, setOpen] = useState(false);

  const handleClear = useCallback(async () => {
    const result = await clear();
    setOpen(false);
    if (result.ok) {
      toast.success(t(`${K}.toast_cleared`));
    } else {
      toast.error(result.message ?? t(`${K}.toast_clear_failed`));
    }
  }, [clear, t]);

  const header = (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t(`${K}.card.description`)}
      </CardDescription>
    </CardHeader>
  );

  // --- Loading: the real row box wearing slivers, so the height resolves ---
  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <div className={cn(ROW_GROUP, GROUP_FILL)}>
            <div className={ROW.ROOT}>
              <div className={ROW.TEXT}>
                <Skeleton className={cn(SKELETON.SIMS.LABEL, "w-36")} />
                <Skeleton className={cn(SKELETON.SIMS.ID, "w-full")} />
                <Skeleton className={cn(SKELETON.SIMS.ID, "w-2/3")} />
              </div>
              <div className={ROW.CONTROL}>
                <Skeleton className={SKELETON.SIMS.CHIP} />
              </div>
            </div>
          </div>
        </CardContent>
        <CardFoot
          className={CARD_PAD}
          liveStatus={false}
          aria-hidden="true"
          actions={<Skeleton className={SKELETON.SIMS.ACTION} />}
        />
      </Card>
    );
  }

  // --- Read failure: the set may well be intact, the read is what failed ---
  if (count === null) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <ConditionBlock
            tone="destructive"
            glyph={CircleAlertIcon}
            ariaRole="alert"
            title={t(`${K}.states.error_title`)}
            description={t(`${K}.states.error_description`)}
            onRetry={() => void refresh()}
            retryLabel={t("actions.retry", { ns: "common" })}
            className={CONDITION_PANEL.SCREEN}
          />
        </CardContent>
      </Card>
    );
  }

  // --- Empty ---
  if (count === 0) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <ConditionBlock
            tone="neutral"
            glyph={CardSimIcon}
            ariaRole="status"
            title={t(`${K}.states.empty_title`)}
            description={t(`${K}.states.empty_description`)}
            className={CONDITION_PANEL.SCREEN}
          />
        </CardContent>
      </Card>
    );
  }

  // --- Data ---
  return (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <div className={cn(ROW_GROUP, GROUP_FILL)}>
          {/* Declared here and not inherited: this card mounts after the page's
              cascade has run, and a variants-only child would wait at opacity 0. */}
          <motion.div
            variants={staggerRowItem}
            initial="hidden"
            animate="visible"
            className={ROW.ROOT}
          >
            <div className={ROW.TEXT}>
              <span className={ROW.LABEL}>{t(`${K}.rows.count.label`)}</span>
              <span className={ROW.CONSEQUENCE}>
                {t(`${K}.rows.count.consequence`)}
              </span>
            </div>
            <div className={ROW.CONTROL}>
              <span className={VALUE}>{count}</span>
            </div>
          </motion.div>
        </div>
      </CardContent>

      <CardFoot
        className={CARD_PAD}
        actions={
          <Button
            type="button"
            variant="destructive"
            size="action"
            onClick={() => setOpen(true)}
            disabled={isClearing}
          >
            <Trash2Icon className={PILL_GLYPH} aria-hidden="true" />
            {t(`${K}.clear_button`)}
          </Button>
        }
      />

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.clear_dialog_title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.clear_dialog_description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing} size="action">
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="action"
              disabled={isClearing}
              onClick={(e) => {
                // Keep the dialog mounted through the request so the button can
                // show its own in-flight state; Radix would close it otherwise.
                e.preventDefault();
                void handleClear();
              }}
            >
              {isClearing ? (
                <>
                  <Loader2Icon
                    className="size-4 motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                  {t(`${K}.clear_dialog_clearing`)}
                </>
              ) : (
                t(`${K}.clear_dialog_confirm`)
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
