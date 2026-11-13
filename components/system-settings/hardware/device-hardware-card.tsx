"use client";

import type * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  CircuitBoardIcon,
  CircleAlertIcon,
  HelpCircleIcon,
  UnplugIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { useDeviceHardware } from "@/hooks/use-device-hardware";

import { ConditionBlock } from "../condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHIP_GLYPH,
  CONDITION_PANEL,
  DEVICE_FACT,
  FACT_NONE,
  GROUP_FILL,
  ROW_GROUP,
  SKELETON_HARDWARE,
} from "../shapes";

// =============================================================================
// Device hardware — what THIS device has, beside the two vendor paths
// =============================================================================
// The page's other two cards toggle a vendor service, and on a SKU without
// those services both collapse to "Not on this modem". The page then explains
// the SKU rather than hiding it: the board and the Ethernet port it does have
// are real hardware content, and they come from the endpoint the Ethernet page
// already owns (`network/ethernet.sh`), read-only.
//
// READ-ONLY, so there is no draft and no `CardFoot`: no control, nothing to
// commit. A backend that does not report `link`/`board` is not an error — the
// card says "not reported" and the two vendor cards beside it are unaffected.
// =============================================================================

const K = "device_hardware";

/** `2500` -> `"2.5 Gbps"`, the spelling the Ethernet page already uses. */
function formatRate(mbps: number | null): string {
  if (mbps === null || mbps <= 0) return FACT_NONE;
  if (mbps >= 1000) return `${mbps / 1000} Gbps`;
  return `${mbps} Mbps`;
}

function DeviceHardwareHeader() {
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

function DeviceHardwareSkeleton() {
  return (
    <Card className={CARD_SHELL} aria-hidden="true">
      <DeviceHardwareHeader />
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <div className={cn(ROW_GROUP, GROUP_FILL)}>
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className={DEVICE_FACT.ROOT}>
              <Skeleton className={cn(SKELETON_HARDWARE.LABEL, "w-28")} />
              <Skeleton className={cn(SKELETON_HARDWARE.LABEL, "w-24")} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FactRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div variants={staggerRowItem} className={DEVICE_FACT.ROOT}>
      <span className={DEVICE_FACT.KEY}>{label}</span>
      {children}
    </motion.div>
  );
}

const DeviceHardwareCard = () => {
  const { t } = useTranslation("system-settings");
  const { state, isLoading, error, refresh } = useDeviceHardware();

  if (isLoading && state === null) return <DeviceHardwareSkeleton />;

  if (state === null) {
    return (
      <Card className={CARD_SHELL}>
        <DeviceHardwareHeader />
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          {error ? (
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
          ) : (
            // Not a fault: an older backend simply does not report these two
            // fields, and the rest of the page still works.
            <ConditionBlock
              tone="neutral"
              glyph={CircuitBoardIcon}
              ariaRole="status"
              title={t(`${K}.unreported_title`)}
              description={t(`${K}.unreported_description`)}
              className={CONDITION_PANEL.SCREEN}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  const { link, board } = state;
  const up = link.operstate === "up";
  const down = link.operstate === "down";
  // Speed and duplex are properties of one negotiated link, so both read as an
  // absence while it is down — the same rule the Ethernet page's band follows.
  const rate = up ? formatRate(link.speed) : FACT_NONE;
  const duplex =
    up && link.duplex === "full"
      ? t(`${K}.duplex_full`)
      : up && link.duplex === "half"
        ? t(`${K}.duplex_half`)
        : FACT_NONE;

  return (
    <Card className={CARD_SHELL}>
      <DeviceHardwareHeader />
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {/* Declared here and not inherited: the card swaps in after its
            skeleton, once the page cascade has already run. */}
        <motion.div
          className={cn(ROW_GROUP, GROUP_FILL)}
          variants={staggerRows}
          initial="hidden"
          animate="visible"
        >
          <FactRow label={t(`${K}.board_label`)}>
            <span
              className={cn(
                DEVICE_FACT.VALUE,
                board ? DEVICE_FACT.VALUE_MONO : DEVICE_FACT.VALUE_QUIET,
              )}
            >
              {board ?? FACT_NONE}
            </span>
          </FactRow>

          <FactRow label={t(`${K}.port_label`)}>
            {/* Three states, three glyphs: colour never carries the state. */}
            <Badge variant={up ? "success" : "muted"}>
              {up ? (
                <CheckCircle2Icon className={CHIP_GLYPH} aria-hidden="true" />
              ) : down ? (
                <UnplugIcon className={CHIP_GLYPH} aria-hidden="true" />
              ) : (
                <HelpCircleIcon className={CHIP_GLYPH} aria-hidden="true" />
              )}
              {up
                ? t(`${K}.link_up`)
                : down
                  ? t(`${K}.link_down`)
                  : t(`${K}.link_unknown`)}
            </Badge>
          </FactRow>

          <FactRow label={t(`${K}.speed_label`)}>
            <span className={cn(DEVICE_FACT.VALUE, rate === FACT_NONE && DEVICE_FACT.VALUE_QUIET)}>
              {rate}
            </span>
          </FactRow>

          <FactRow label={t(`${K}.duplex_label`)}>
            <span
              className={cn(
                DEVICE_FACT.VALUE,
                duplex === FACT_NONE && DEVICE_FACT.VALUE_QUIET,
              )}
            >
              {duplex}
            </span>
          </FactRow>
        </motion.div>
      </CardContent>
    </Card>
  );
};

export default DeviceHardwareCard;
