"use client";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { MutationResult } from "@/types/mutation-result";
import { DANGER } from "./shapes";

interface EngineRemoveRowProps {
  isUninstalling: boolean;
  onUninstall: () => Promise<MutationResult>;
  onUninstalled: () => void;
}

/**
 * Removes the engine both modes share. Rendered by the composer only while the
 * engine is settled idle, at the foot of the status card. Low emphasis on
 * purpose: destructive is the button, not the surface.
 */
export function EngineRemoveRow({
  isUninstalling,
  onUninstall,
  onUninstalled,
}: EngineRemoveRowProps) {
  const { t } = useTranslation("local-network");

  const remove = async () => {
    const result = await onUninstall();
    if (result.ok) {
      toast.success(t("traffic_engine.advanced_toast_success"));
      onUninstalled();
    } else {
      toast.error(
        resolveErrorMessage(
          t,
          result.code,
          result.error,
          t("traffic_engine.advanced_toast_error"),
        ),
      );
    }
  };

  return (
    <div className={DANGER.ROOT}>
      <div className={DANGER.TEXT}>
        <p className={DANGER.TITLE}>{t("traffic_engine.advanced_remove_title")}</p>
        <p className={DANGER.DESC}>{t("traffic_engine.advanced_remove_desc")}</p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="tonal-destructive" disabled={isUninstalling}>
            {isUninstalling ? (
              <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <Trash2Icon aria-hidden="true" />
            )}
            {isUninstalling
              ? t("traffic_engine.advanced_removing")
              : t("traffic_engine.advanced_remove_button")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("traffic_engine.advanced_dialog_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("traffic_engine.advanced_dialog_desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void remove()}
            >
              {t("traffic_engine.advanced_remove_button")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
