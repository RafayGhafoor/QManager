"use client";

import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConnectionStatus } from "@/lib/reboot/connection";

/**
 * Transient banner shown when the dashboard has missed a couple of consecutive
 * health checks but has not yet crossed the auto-logout threshold. Gives the
 * user a heads-up ("reconnecting…") instead of an abrupt logout. Driven by the
 * connection-status signal reported from use-auto-logout. Distinct from the
 * deferred pending-reboot banner, so the two never collide.
 *
 * Motion: the shared `animate-banner-in` entrance (emphasized clock, stops
 * under Reduced) and no exit. DESIGN.md > The Enter-Only Rule: the banner
 * leaving means contact came back, and that should read as immediate.
 */
export function ReconnectingBanner() {
  const { reconnecting } = useConnectionStatus();
  const { t } = useTranslation("common");

  if (!reconnecting) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-banner-in mx-2 mb-2 flex items-center gap-2 rounded-field bg-warning-container px-3 py-2 text-sm text-on-warning-container lg:mx-6"
    >
      <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
      <span>{t("connection.reconnecting")}</span>
    </div>
  );
}
