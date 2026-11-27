"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

import { TonalBanner } from "@/components/ui/tonal-banner";
import type { CellHistoryRecorder } from "@/types/cell-history";

import { formatAgo } from "./derive";
import { BANNERS } from "./shapes";

// =============================================================================
// StatusBanners — why the page may look the way it does
// =============================================================================
// Two things a reader cannot see from the charts, said once above them:
//
//   RECORDER. The window ends at the wall clock (history-v3), so a recorder that
//   stopped shows an empty tail rather than silently passing old data off as the
//   last 24 hours. This says WHY the tail is empty. The `empty` state is not
//   here: it has no data to show, so the page's empty-state owns it.
//
//   CLOCK. The archive's day files are cut in UTC but every figure on this page
//   is the viewer's local time. When the router thinks it is in a different time
//   zone than the browser, "03:10" on a chart is the viewer's 03:10 while the
//   router's own logs say something else - an unannounced shift, so it is said.
//
// Both are notices about the page's inputs, not faults of the radio, so neither
// is destructive: `warning` for a recorder that is not recording, `info` for a
// clock offset that changes nothing about the data.
// =============================================================================

export interface StatusBannersProps {
  recorder: CellHistoryRecorder;
  deviceUtcOffsetMin: number;
}

export function StatusBanners({ recorder, deviceUtcOffsetMin }: StatusBannersProps) {
  const { t, i18n } = useTranslation("cellular");

  // `getTimezoneOffset` is minutes WEST of UTC (CST6 is +360); the contract's
  // offset is minutes EAST (CST6 is -360), hence the sign.
  const browserOffsetMin = -new Date().getTimezoneOffset();
  const clockDiffers = deviceUtcOffsetMin !== browserOffsetMin;

  return (
    <div className={BANNERS}>
      {recorder.state === "stale" && recorder.stale_sec !== null ? (
        <TonalBanner tone="warning" icon="history" size="compact">
          {t("history.banner.stale", {
            ago: formatAgo(recorder.stale_sec, i18n.language),
          })}
        </TonalBanner>
      ) : null}

      {recorder.state === "low_space" ? (
        <TonalBanner tone="warning" icon="warning" size="compact">
          {t("history.banner.low_space")}
        </TonalBanner>
      ) : null}

      {recorder.state === "clock_unset" ? (
        <TonalBanner tone="warning" icon="schedule" size="compact">
          {t("history.banner.clock_unset")}
        </TonalBanner>
      ) : null}

      {clockDiffers ? (
        <TonalBanner tone="info" icon="schedule" size="compact">
          {t("history.banner.timezone")}{" "}
          <Link
            href="/system-settings"
            className="font-semibold underline underline-offset-2"
          >
            {t("history.banner.timezone_link")}
          </Link>
        </TonalBanner>
      ) : null}
    </div>
  );
}

export default StatusBanners;
