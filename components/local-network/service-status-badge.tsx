"use client";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  CheckCircle2Icon,
  MinusCircleIcon,
  PackageIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

type ServiceTone = "running" | "stopped";

// Tone and glyph key onto `BadgeVariant`, never a class string, so a tone
// without a matching chip role fails the build (DESIGN.md > Status chips).
// Stopped is a deliberate state, not a failure, hence `muted`.
const SERVICE_BADGE: Record<ServiceTone, BadgeVariant> = {
  running: "success",
  stopped: "muted",
};

const SERVICE_GLYPH: Record<ServiceTone, LucideIcon> = {
  running: CheckCircle2Icon,
  stopped: MinusCircleIcon,
};

export function ServiceStatusBadge({
  status,
  installed = true,
}: {
  status: string;
  installed?: boolean;
}) {
  const { t } = useTranslation("local-network");
  const tone: ServiceTone = status === "running" ? "running" : "stopped";
  // Not installed is its own state, not a flavour of stopped: it takes its own
  // glyph so the two muted chips differ by more than their words.
  const Glyph =
    tone === "stopped" && !installed ? PackageIcon : SERVICE_GLYPH[tone];

  return (
    <Badge variant={SERVICE_BADGE[tone]}>
      <Glyph className="size-3" aria-hidden="true" />
      {tone === "running"
        ? t("shared.status_active")
        : installed
          ? t("shared.status_inactive")
          : t("shared.status_not_installed")}
    </Badge>
  );
}
