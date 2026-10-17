"use client";

import { Trans, useTranslation } from "react-i18next";
import { Download, Loader2, PackageIcon, RefreshCcwIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { InstallResult } from "@/types/video-optimizer";
import { cn } from "@/lib/utils";
import { ResultAlert } from "./result-alert";
import {
  CARD_PAD,
  CONDITION,
  CONDITION_TONE,
  HERO_SHELL,
  NOTICE_DETAIL,
} from "./shapes";

interface EngineOnboardingProps {
  installResult: InstallResult;
  onInstall: () => void;
  onRefresh: () => void;
}

/**
 * The not-installed shape of the page: one hero card that IS the state. One
 * install unlocks both modes, so it replaces the status, tabs and hostlist.
 */
export function EngineOnboarding({
  installResult,
  onInstall,
  onRefresh,
}: EngineOnboardingProps) {
  const { t } = useTranslation("local-network");
  const installing = installResult.status === "running";
  const tone = CONDITION_TONE.muted;

  return (
    <Card className={HERO_SHELL}>
      <CardContent className={CARD_PAD} aria-live="polite">
        <div className={cn(CONDITION.ROOT, tone.ROOT)}>
          <span aria-hidden className={cn(CONDITION.DISC, tone.DISC)}>
            <PackageIcon className={CONDITION.GLYPH} />
          </span>
          <h2 className={CONDITION.TITLE}>{t("traffic_engine.onboarding_title")}</h2>
          <p className={CONDITION.DESC}>
            {t("traffic_engine.onboarding_description")}{" "}
            <Trans
              i18nKey="traffic_engine.onboarding_zapret_attribution"
              ns="local-network"
              components={{
                link: (
                  <a
                    href="https://github.com/bol-van/zapret"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline underline-offset-2"
                  />
                ),
              }}
            />
          </p>

          <div className={CONDITION.ACTIONS}>
            <Button size="action" onClick={onInstall} disabled={installing}>
              {installing ? (
                <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <Download aria-hidden="true" />
              )}
              {installing
                ? installResult.message || t("traffic_engine.onboarding_installing")
                : t("traffic_engine.onboarding_install")}
            </Button>
            <Button
              variant="ghost"
              size="action"
              onClick={onRefresh}
              disabled={installing}
              className={tone.ACTION}
            >
              <RefreshCcwIcon aria-hidden="true" />
              {t("traffic_engine.onboarding_check_again")}
            </Button>
          </div>

          {installResult.status === "complete" || installResult.status === "error" ? (
            <div className={CONDITION.NOTES}>
              <ResultAlert
                tone={installResult.status === "complete" ? "success" : "destructive"}
              >
                {installResult.message}
                {installResult.detail ? (
                  <span className={NOTICE_DETAIL}>{installResult.detail}</span>
                ) : null}
              </ResultAlert>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
