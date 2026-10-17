"use client";

import { useTranslation } from "react-i18next";

/**
 * The foot status both mode panels share. A dirty draft on a running mode is
 * an unsaved change; on an idle mode it rides along with the next enable, and
 * the line says so instead of offering an Apply that cannot reach the engine.
 */
export function DraftStatus({
  dirty,
  running,
}: {
  dirty: boolean;
  running: boolean;
}) {
  const { t } = useTranslation("local-network");
  if (!dirty) return null;
  return (
    <span className="font-medium">
      {running
        ? t("common:state.unsaved")
        : t("traffic_engine.draft_applies_on_enable")}
    </span>
  );
}
