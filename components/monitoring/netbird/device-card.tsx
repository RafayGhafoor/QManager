"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { UnplugIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { NetBirdStatus } from "@/hooks/use-netbird";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_HEAD_TEXT,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  METRIC,
  SKELETON,
  type NetbirdView,
} from "./shapes";
import { ControlPlaneChip } from "./status-band";

// -----------------------------------------------------------------------------
// This device — the mesh identity, as pill rows. No hairlines.
// -----------------------------------------------------------------------------

interface IdentityRow {
  key: string;
  label: string;
  /** An identifier the device emitted renders mono; a chip is passed as a node. */
  value: React.ReactNode;
  mono: boolean;
  title?: string;
}

function identityRows(
  status: NetBirdStatus,
  t: (key: string) => string,
): IdentityRow[] {
  const rows: IdentityRow[] = [];
  if (status.fqdn)
    rows.push({
      key: "fqdn",
      label: t("netbird.device.fqdn"),
      value: status.fqdn,
      title: status.fqdn,
      mono: true,
    });
  if (status.netbird_ip)
    rows.push({
      key: "ip",
      label: t("netbird.device.netbirdIp"),
      value: status.netbird_ip,
      title: status.netbird_ip,
      mono: true,
    });
  if (status.interface_type)
    rows.push({
      key: "interface",
      label: t("netbird.device.interface"),
      value: status.interface_type,
      title: status.interface_type,
      mono: true,
    });
  if (status.management)
    rows.push({
      key: "management",
      label: t("netbird.device.management"),
      value: <ControlPlaneChip raw={status.management} />,
      mono: false,
    });
  if (status.signal)
    rows.push({
      key: "signal",
      label: t("netbird.device.signal"),
      value: <ControlPlaneChip raw={status.signal} />,
      mono: false,
    });
  return rows;
}

export function DeviceCard({
  view,
  status,
}: {
  view: NetbirdView;
  status: NetBirdStatus;
}) {
  const { t } = useTranslation("monitoring");
  const rows = view === "connected" ? identityRows(status, t) : [];

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("netbird.device.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("netbird.device.description")}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {rows.length === 0 ? (
          <ConditionBlock
            tone="muted"
            icon={UnplugIcon}
            title={t("netbird.device.emptyTitle")}
            description={t("netbird.device.emptyDescription")}
          />
        ) : (
          // Nested container: it inherits `visible` and must NOT declare its own.
          <motion.div className={METRIC.STACK} variants={staggerRows}>
            {rows.map((row) => (
              <motion.div
                key={row.key}
                className={METRIC.ROW}
                variants={staggerRowItem}
              >
                <span className={METRIC.LABEL}>{row.label}</span>
                <span
                  className={row.mono ? METRIC.VALUE_MONO : METRIC.VALUE}
                  title={row.title}
                >
                  {row.value}
                </span>
              </motion.div>
            ))}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

/** Mirrors the loaded row height from the same constant. */
export function DeviceCardSkeleton() {
  const { t } = useTranslation("monitoring");
  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("netbird.device.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("netbird.device.description")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, CARD_BODY)} aria-hidden>
        <div className={METRIC.STACK}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className={SKELETON.METRIC} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

