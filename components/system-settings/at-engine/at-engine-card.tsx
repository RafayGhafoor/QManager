"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  AlertTriangleIcon,
  CheckIcon,
  CircleCheckIcon,
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
import { HintIcon } from "@/components/ui/hint-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { staggerRows, staggerRowItem } from "@/lib/motion";

import { useAtEngine } from "@/hooks/use-at-engine";
import type { AtEngine } from "@/types/at-engine";
import { SETTING_ROW, SettingRow } from "./setting-row";

// =============================================================================
// Modem Commands — choose how QManager talks to the modem
// =============================================================================
// Fast = the AT broker (default); Legacy = the original shell gatekeeper, kept
// for rollback. Both return identical results, so the choice is about speed
// and robustness, never about what the rest of the app sees. Applying it is
// safe: it never touches the cellular connection. docs/features/at-broker.md.
// =============================================================================

const AtEngineCard = () => {
  const { t } = useTranslation("system-settings");
  const { state, isLoading, isSaving, error, setEngine, refresh } = useAtEngine();
  const { saved, markSaved } = useSaveFlash();

  // Draft follows the saved value whenever the device reports a new one
  // (initial load, or the read-back after an apply). Adjust-during-render, not
  // an effect (React Compiler rule).
  const savedEngine = state?.engine ?? null;
  const [draft, setDraft] = useState<AtEngine | null>(null);
  const [seen, setSeen] = useState<AtEngine | null>(null);
  if (savedEngine !== seen) {
    setSeen(savedEngine);
    setDraft(savedEngine);
  }

  const dirty = draft !== null && savedEngine !== null && draft !== savedEngine;
  const inEffect = state !== null && state.effective === state.engine;

  const handleApply = async () => {
    if (!draft || !dirty) return;
    const result = await setEngine(draft);
    if (result.ok) {
      markSaved();
      toast.success(
        draft === "broker"
          ? t("at_engine.toast_fast")
          : t("at_engine.toast_legacy"),
      );
    } else {
      toast.error(result.error ?? t("at_engine.toast_failed"));
    }
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("at_engine.card_title")}</CardTitle>
        <CardDescription>{t("at_engine.card_description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-2">
            <div className={SETTING_ROW}>
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-[2.625rem] w-44 rounded-pill" />
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
              <SettingRow
                label={
                  <>
                    {t("at_engine.engine_label")}
                    <HintIcon label={t("at_engine.engine_label")}>
                      {t("at_engine.engine_hint")}
                    </HintIcon>
                  </>
                }
              >
                <SegmentedField<AtEngine>
                  value={draft}
                  onValueChange={setDraft}
                  ariaLabel={t("at_engine.engine_label")}
                  breakpoint="never"
                  disabled={isSaving}
                  options={[
                    {
                      value: "broker",
                      label: t("at_engine.option_fast"),
                      disabled: !state.brokerAvailable,
                    },
                    { value: "legacy", label: t("at_engine.option_legacy") },
                  ]}
                  glyph={(className) => (
                    <CheckIcon className={className} size={16} aria-hidden="true" />
                  )}
                />
              </SettingRow>
            </motion.div>

            {!state.brokerAvailable && (
              <motion.p
                variants={staggerRowItem}
                className="text-sm text-muted-foreground"
              >
                {t("at_engine.fast_unavailable")}
              </motion.p>
            )}

            {/* State honesty: report what the device is using, not the draft. */}
            <motion.div variants={staggerRowItem}>
              <SettingRow label={t("at_engine.status_label")}>
                {inEffect ? (
                  <Badge variant="success">
                    <CircleCheckIcon className="size-3" aria-hidden="true" />
                    {state.effective === "broker"
                      ? t("at_engine.status_fast")
                      : t("at_engine.status_legacy")}
                  </Badge>
                ) : (
                  <Badge variant="warning">
                    <AlertTriangleIcon className="size-3" aria-hidden="true" />
                    {t("at_engine.status_not_applied")}
                  </Badge>
                )}
              </SettingRow>
            </motion.div>
          </motion.div>
        ) : null}
      </CardContent>

      {state && (
        <CardFoot
          className="px-6"
          status={
            dirty ? (
              <span className="font-medium">{t("at_engine.pending")}</span>
            ) : null
          }
          actions={
            <>
              <Button
                type="button"
                variant="tonal-neutral"
                size="action"
                onClick={() => setDraft(savedEngine)}
                disabled={!dirty || isSaving}
              >
                {t("at_engine.discard")}
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

export default AtEngineCard;
