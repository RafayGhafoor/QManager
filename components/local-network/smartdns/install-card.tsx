"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { DownloadIcon, InfoIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { SmartDnsInstallState } from "@/types/smartdns";

import { CARD_DESC, CARD_PAD, CARD_SHELL, CARD_TITLE, INSTALL } from "./shapes";

// =============================================================================
// InstallCard — the resolver is not on this device yet
// =============================================================================
// The one state the page has to get right without a backend to lean on. A device
// with no smartdns package is the DEFAULT state on this platform, so this is not
// an error path — it is a normal first visit, and it must read as one: what the
// feature is, what installing does, and what it does NOT do.
//
// -----------------------------------------------------------------------------
// THE THREE FACTS UNDER THE LEAD ARE THE WHOLE SAFETY STORY
// -----------------------------------------------------------------------------
// Install is a package operation, and the fear it has to answer is "will this
// change my DNS". It does not: installing stops at the package. The resolver is
// off, dnsmasq is untouched, and every client keeps resolving exactly as before
// until someone turns the resolver on and then routes the LAN through it. Saying
// that here, in three lines rather than a paragraph, is why the Install button is
// safe to press.
//
// Nothing on this card is on a timer. A download that reports progress through a
// result file on the device is polled by the hook, not by a spinner that guesses.
// =============================================================================

const K = "smartdns";

export interface InstallCardProps {
  /** The device's last package action, or null when none has run. */
  install: SmartDnsInstallState | null;
  isInstalling: boolean;
  /** The last failure, already translated. */
  error: string | null;
  onInstall: () => void;
}

export function InstallCard({
  install,
  isInstalling,
  error,
  onInstall,
}: InstallCardProps) {
  const { t } = useTranslation("local-network");

  const running = isInstalling || install?.status === "installing";
  const failed = install?.status === "error" || error !== null;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.install.title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.install.description`)}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, INSTALL.ROOT)}>
        <div className={INSTALL.LEAD}>
          <span aria-hidden="true" className={INSTALL.DISC}>
            <DownloadIcon className={INSTALL.GLYPH} />
          </span>
          <div className={INSTALL.TEXT}>
            <p className={INSTALL.TITLE}>
              {running
                ? (install?.message ?? t(`${K}.install.progress_default`))
                : t(`${K}.install.lead_title`)}
            </p>
            <p className={INSTALL.BODY}>
              {running ? t(`${K}.install.progress_body`) : t(`${K}.install.lead_body`)}
            </p>
          </div>
        </div>

        {failed ? (
          <div role="alert" className={INSTALL.LIST}>
            <p className={cn(INSTALL.LIST_ITEM, "text-destructive-on-surface")}>
              <TriangleAlertIcon className={INSTALL.LIST_GLYPH} aria-hidden="true" />
              <span>
                {install?.status === "error"
                  ? install.message
                  : (error ?? t(`${K}.install.failed`))}
                {install?.status === "error" && install.detail
                  ? ` ${t(`${K}.install.failed_detail`, { detail: install.detail })}`
                  : null}
              </span>
            </p>
          </div>
        ) : null}

        <ul className={INSTALL.LIST}>
          <li className={INSTALL.LIST_ITEM}>
            <ShieldCheckIcon className={INSTALL.LIST_GLYPH} aria-hidden="true" />
            <span>{t(`${K}.install.fact_dns_untouched`)}</span>
          </li>
          <li className={INSTALL.LIST_ITEM}>
            <InfoIcon className={INSTALL.LIST_GLYPH} aria-hidden="true" />
            <span>{t(`${K}.install.fact_package`)}</span>
          </li>
          <li className={INSTALL.LIST_ITEM}>
            <InfoIcon className={INSTALL.LIST_GLYPH} aria-hidden="true" />
            <span>{t(`${K}.install.fact_reversible`)}</span>
          </li>
        </ul>

        <div className={INSTALL.ACTIONS}>
          <Button
            type="button"
            size="action"
            onClick={onInstall}
            disabled={running}
          >
            {running ? (
              <Spinner className="size-4" />
            ) : (
              <DownloadIcon className="size-4" aria-hidden="true" />
            )}
            {running ? t(`${K}.install.installing`) : t(`${K}.install.action`)}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default InstallCard;
