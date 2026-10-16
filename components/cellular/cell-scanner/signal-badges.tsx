"use client";

import { useTranslation } from "react-i18next";
import {
  SignalHighIcon,
  SignalLowIcon,
  SignalMediumIcon,
  SignalZeroIcon,
  type LucideIcon,
} from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Tag, type TagVariant } from "@/components/ui/tag";

type SignalTier = "good" | "fair" | "poor" | "none";

// Tiers key onto `BadgeVariant`; the bar-count glyph carries the tier, since
// success and warning fills are 1.03:1 apart.
const SIGNAL_BADGE: Record<SignalTier, { variant: BadgeVariant; Icon: LucideIcon }> = {
  good: { variant: "success", Icon: SignalHighIcon },
  fair: { variant: "warning", Icon: SignalMediumIcon },
  poor: { variant: "destructive", Icon: SignalLowIcon },
  none: { variant: "muted", Icon: SignalZeroIcon },
};

// Literal keys so the i18n checker can see them.
const SIGNAL_LABEL_KEY: Record<SignalTier, string> = {
  good: "cell_scanner.signal_badge.good",
  fair: "cell_scanner.signal_badge.fair",
  poor: "cell_scanner.signal_badge.bad",
  none: "cell_scanner.signal_badge.no_data",
};

function signalTier(strength: number | null | undefined): SignalTier {
  // 0 dBm is the scan workers' "unreported" sentinel, not a reading.
  if (strength === null || strength === undefined || strength === 0) return "none";
  if (strength >= -85) return "good";
  if (strength >= -100) return "fair";
  return "poor";
}

/** Measured signal quality: a filled status chip with a per-tier bar glyph. */
export function SignalBadge({ strength }: { strength: number | null }) {
  const { t } = useTranslation("cellular");
  const tier = signalTier(strength);
  const { variant, Icon } = SIGNAL_BADGE[tier];

  return (
    <Badge variant={variant}>
      <Icon className="size-3" aria-hidden="true" />
      {t(SIGNAL_LABEL_KEY[tier])}
    </Badge>
  );
}

/** Radio identity, an outline `Tag`, never a verdict. */
function networkIdentity(type: string): TagVariant {
  return type.toUpperCase().startsWith("NR") ? "nr" : "lte";
}

export function NetworkTypeBadge({ type }: { type: string }) {
  return <Tag variant={networkIdentity(type)}>{type}</Tag>;
}
