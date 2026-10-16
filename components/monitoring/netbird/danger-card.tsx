"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2Icon, Trash2Icon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { NetBirdActionResult } from "@/hooks/use-netbird";
import { rebootNow, requestRebootLater } from "@/lib/reboot";

import { DANGER } from "./shapes";

// -----------------------------------------------------------------------------
// Remove NetBird — a low-emphasis row. Destructive is the button, not the row.
// -----------------------------------------------------------------------------

export function DangerRow({
  isUninstalling,
  uninstall,
  onUninstalled,
}: {
  isUninstalling: boolean;
  uninstall: () => Promise<NetBirdActionResult>;
  onUninstalled: () => void;
}) {
  const { t } = useTranslation("monitoring");

  const handleUninstall = async () => {
    const result = await uninstall();
    if (result.success) {
      toast.success(t("netbird.toast.uninstalled"));
      onUninstalled();
    } else {
      toast.error(result.error || t("netbird.toast.uninstallFailed"));
    }
  };

  return (
    <div className={DANGER.ROOT}>
      <div className={DANGER.TEXT}>
        <p className={DANGER.TITLE}>{t("netbird.danger.title")}</p>
        <p className={DANGER.DESC}>{t("netbird.danger.description")}</p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="destructive"
            disabled={isUninstalling}
            size="action"
          >
            {isUninstalling ? (
              <Loader2Icon className="size-4 motion-safe:animate-spin" />
            ) : (
              <Trash2Icon className="size-4" />
            )}
            {isUninstalling
              ? t("netbird.danger.removing")
              : t("netbird.danger.uninstall")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("netbird.danger.dialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("netbird.danger.dialogDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("netbird.actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleUninstall}>
              {t("netbird.danger.uninstall")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The post-uninstall reboot handoff. Owned by the page shell, not by the row:
 * a successful uninstall flips the surface to its not-installed shape, which
 * would unmount the row and take the dialog with it.
 */
export function RebootDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("monitoring");
  const [isRebooting, setIsRebooting] = React.useState(false);

  const reboot = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsRebooting(true);
    // Fire-and-forget POST, then the shared /reboot/ countdown hand-off.
    rebootNow("netbird");
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (isRebooting) return;
        // Declining (Reboot later, Escape, scrim) raises the persistent
        // deferred-reboot banner so the pending reboot is never lost.
        if (!next) requestRebootLater("netbird");
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("netbird.danger.rebootTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("netbird.danger.rebootDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRebooting}>
            {t("netbird.danger.rebootLater")}
          </AlertDialogCancel>
          <AlertDialogAction disabled={isRebooting} onClick={reboot}>
            {isRebooting ? (
              <Loader2Icon className="size-4 motion-safe:animate-spin" />
            ) : null}
            {isRebooting
              ? t("netbird.danger.rebooting")
              : t("netbird.danger.rebootNow")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
