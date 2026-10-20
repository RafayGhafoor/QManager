"use client";

import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { CircleAlertIcon, DownloadIcon, Loader2Icon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CARD_FOOT, CARD_FOOT_ACTIONS } from "@/components/ui/card-foot";
import { cn } from "@/lib/utils";

import { useDiagnostics } from "@/hooks/use-diagnostics";

import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  NOTICE,
  PILL_GLYPH,
} from "../shapes";

// =============================================================================
// Debug Report — a one-click plain-text snapshot, downloaded to this device
// =============================================================================
// Mounted at the foot of System Health Check in every page state: it needs no
// check run, so it is reachable even when the checks cannot load. The capture
// is an operational action, not a draft commit, so the footer carries only the
// action (CARD_FOOT constants, no empty status slot).
// =============================================================================

const K = "diagnostics";

const DiagnosticsCard = () => {
  const { t } = useTranslation("system-settings");
  const { stage, error, capture } = useDiagnostics();

  const isCapturing = stage === "capturing";

  const handleCapture = async () => {
    const ok = await capture();
    if (ok) {
      toast.success(t(`${K}.toast_success`));
    } else {
      toast.error(t(`${K}.toast_failed`));
    }
  };

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card_title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.card_description`)}
        </CardDescription>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, CARD_BODY, "gap-4")}>
        <p className="text-on-surface-variant max-w-[72ch] text-sm leading-relaxed text-pretty">
          {t(`${K}.body`)}
        </p>

        {stage === "error" && error ? (
          <div role="alert" className={cn(NOTICE.BOX, NOTICE.FAILED)}>
            <CircleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <span className={NOTICE.TEXT}>{error}</span>
          </div>
        ) : null}

        <div className={cn(CARD_FOOT, "pt-0")}>
          <div className={CARD_FOOT_ACTIONS}>
            <Button
              type="button"
              size="action"
              onClick={handleCapture}
              disabled={isCapturing}
            >
              {isCapturing ? (
                <Loader2Icon
                  className={cn(PILL_GLYPH, "motion-safe:animate-spin")}
                  aria-hidden="true"
                />
              ) : (
                <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
              )}
              {isCapturing
                ? t(`${K}.button_capturing`)
                : t(`${K}.button_capture`)}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DiagnosticsCard;
