"use client";

import { useTranslation } from "react-i18next";
import { FIELD } from "./shapes";

/**
 * The note both mode panels show under their field. A running mode applies the
 * field as it commits, so only an idle mode has anything to say: the value
 * rides along with the next enable. A Fact-Is-Info line, shown only while it
 * applies.
 */
export function DraftStatus({
  dirty,
  running,
}: {
  dirty: boolean;
  running: boolean;
}) {
  const { t } = useTranslation("local-network");
  if (!dirty || running) return null;
  return (
    <p className={FIELD.HELPER}>{t("traffic_engine.draft_applies_on_enable")}</p>
  );
}
