"use client";

import { useTranslation } from "react-i18next";
import {
  CircleAlertIcon,
  EthernetPortIcon,
  RefreshCcwIcon,
  RouteOffIcon,
  RouterIcon,
  UsbIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PassthroughMode, UsbMode } from "@/types/ip-passthrough";

import {
  CONDITION,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  HERO_PAD,
  HERO_SHELL,
  PILL_GLYPH,
  SKELETON,
  STATUS,
} from "./shapes";

// The saved configuration, not a measurement: the GET reads our own config file,
// so every word here stays "Last applied" / "Set to", never "currently" or "live".
// It answers one question, which topology was last applied. The settings
// themselves live in the card below, so the strip repeats none of them.

const K = "ippt";

/** Protocol names the device round-trips; identical in every locale. */
export const USB_SHORT: Record<UsbMode, string> = {
  "0": "RMNET",
  "1": "ECM",
  "2": "MBIM",
  "3": "RNDIS",
};

const MODE_TITLE_KEY: Record<PassthroughMode, string> = {
  disabled: `${K}.status.mode_title.disabled`,
  eth: `${K}.status.mode_title.eth`,
  usb: `${K}.status.mode_title.usb`,
};

const MODE_BLURB_KEY: Record<PassthroughMode, string> = {
  disabled: `${K}.status.blurb.disabled`,
  eth: `${K}.status.blurb.eth`,
  usb: `${K}.status.blurb.usb`,
};

const MODE_GLYPH = {
  disabled: RouterIcon,
  eth: EthernetPortIcon,
  usb: UsbIcon,
} as const;

export interface StatusStripProps {
  /** `null` until the first successful read. */
  mode: PassthroughMode | null;
  /** True when a read failed and left nothing behind. */
  failed: boolean;
  onRetry: () => void;
}

export function StatusStrip({ mode, failed, onRetry }: StatusStripProps) {
  const { t } = useTranslation("local-network");

  if (mode === null) {
    return failed ? (
      <Card className={HERO_SHELL} role="region" aria-label={t(`${K}.status.label`)}>
        <CardContent className={HERO_PAD}>
          <div role="status" className={CONDITION.ROOT}>
            <span aria-hidden className={CONDITION.DISC}>
              <CircleAlertIcon className={CONDITION.GLYPH} />
            </span>
            <div className={CONDITION.TEXT}>
              <p className={CONDITION.TITLE}>{t(`${K}.errors.read_title`)}</p>
              <p className={CONDITION.BODY}>{t(`${K}.errors.read_body`)}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={onRetry}
              className={CONDITION.ACTION}
            >
              <RefreshCcwIcon className={PILL_GLYPH} aria-hidden />
              {t(`${K}.errors.retry`)}
            </Button>
          </div>
        </CardContent>
      </Card>
    ) : (
      <StatusStripSkeleton />
    );
  }

  const passing = mode !== "disabled";
  const Glyph = MODE_GLYPH[mode];

  return (
    <Card className={HERO_SHELL} role="region" aria-label={t(`${K}.status.label`)}>
      <CardContent className={cn(HERO_PAD, STATUS.BODY)}>
        <div className={STATUS.PHASE}>
          <span
            aria-hidden
            className={cn(
              STATUS.DISC,
              DISC_TRANSITION,
              passing ? DISC_TONE.info : DISC_TONE.neutral,
            )}
          >
            <Glyph className={STATUS.GLYPH} />
          </span>
          <div className={STATUS.TEXT}>
            <span className={EYEBROW}>{t(`${K}.status.label`)}</span>
            <p className={STATUS.TITLE}>{t(MODE_TITLE_KEY[mode])}</p>
            <p className={STATUS.BLURB}>{t(MODE_BLURB_KEY[mode])}</p>
          </div>
        </div>

        {/* A fact, not a fault (Fact-Is-Info): shown only while it applies. */}
        {passing ? (
          <Badge variant="info">
            <RouteOffIcon aria-hidden />
            {t(`${K}.status.gateway_off`)}
          </Badge>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Mirrors the strip from the same constants. */
export function StatusStripSkeleton() {
  return (
    <Card className={HERO_SHELL} aria-hidden>
      <CardContent className={cn(HERO_PAD, STATUS.BODY)}>
        <div className={STATUS.PHASE}>
          <Skeleton className={STATUS.DISC} />
          <div className={cn(STATUS.TEXT, "flex-1")}>
            <Skeleton className={SKELETON.EYEBROW} />
            <Skeleton className={SKELETON.TITLE} />
            <Skeleton className={SKELETON.BLURB} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default StatusStrip;
