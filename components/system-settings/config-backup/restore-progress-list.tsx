"use client";

import {
  CheckCircle2Icon,
  CircleDashedIcon,
  Loader2Icon,
  MinusCircleIcon,
  RefreshCwIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SectionProgress } from "@/types/config-backup";
import { BACKUP_SECTIONS } from "@/lib/config-backup/sections";
import { useTranslation } from "react-i18next";

const LABELS: Record<string, string> = Object.fromEntries(
  BACKUP_SECTIONS.map((s) => [s.key, s.label]),
);

type RestoreTone =
  | "success"
  | "running"
  | "retrying"
  | "failed"
  | "skipped"
  | "pending";

// Tone and glyph key onto `BadgeVariant`, never a class string
// (DESIGN.md > Status chips). Each tone owns a distinct glyph.
const RESTORE_BADGE: Record<RestoreTone, BadgeVariant> = {
  success: "success",
  running: "info",
  retrying: "warning",
  failed: "destructive",
  skipped: "muted",
  pending: "muted",
};

const RESTORE_GLYPH: Record<RestoreTone, LucideIcon> = {
  success: CheckCircle2Icon,
  running: Loader2Icon,
  retrying: RefreshCwIcon,
  failed: XCircleIcon,
  skipped: MinusCircleIcon,
  pending: CircleDashedIcon,
};

function toTone(status: SectionProgress["status"]): RestoreTone {
  if (status === "success") return "success";
  if (status === "running") return "running";
  if (status.startsWith("retrying:")) return "retrying";
  if (status === "failed") return "failed";
  if (status.startsWith("skipped")) return "skipped";
  return "pending";
}

function StatusBadge({
  status,
}: {
  status: SectionProgress["status"];
}) {
  const { t } = useTranslation("system-settings");
  const tone = toTone(status);
  const Glyph = RESTORE_GLYPH[tone];
  const spinning = tone === "running" || tone === "retrying";

  const label =
    tone === "success"
      ? t("config_backup.progress.status_restored")
      : tone === "running"
        ? t("config_backup.progress.status_running")
        : tone === "retrying"
          ? t("config_backup.progress.status_retrying", {
              n: status.split(":")[1],
            })
          : tone === "failed"
            ? t("config_backup.progress.status_failed")
            : tone === "skipped"
              ? t("config_backup.progress.status_skipped")
              : t("config_backup.progress.status_pending");

  // min-width keeps every status chip at an identical width down the list
  return (
    <Badge variant={RESTORE_BADGE[tone]} className="min-w-[7.5rem]">
      <Glyph
        className={cn("size-3", spinning && "animate-spin")}
        aria-hidden="true"
      />
      {label}
    </Badge>
  );
}

export interface RestoreProgressListProps {
  sections: SectionProgress[];
}

export function RestoreProgressList({ sections }: RestoreProgressListProps) {
  const { t } = useTranslation("system-settings");
  return (
    <ul className="grid gap-2 text-sm w-full">
      {sections.map((s) => (
        <li
          key={s.key}
          className="flex items-center justify-between gap-3"
        >
          <span className="text-foreground">
            {t(`config_backup.sections.${s.key}`, LABELS[s.key] ?? s.key)}
          </span>
          <div className="flex items-center gap-2">
            <StatusBadge status={s.status} />
          </div>
        </li>
      ))}
    </ul>
  );
}
