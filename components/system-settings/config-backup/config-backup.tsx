"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import ConfigBackupCard from "./config-backup-card";
import RestoreConfigBackupCard from "./restore-backup-card";
import { Banner, bannerActionVariants } from "@/components/ui/banner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { authFetch } from "@/lib/auth-fetch";
import { staggerContainer, staggerItem } from "@/lib/motion";
import {
  usePendingReboot,
  clearPendingReboot,
  requestRebootLater,
  enterRebootFlow,
} from "@/lib/reboot";

import { CARD_CELL, CARD_GRID, PAGE_HEAD, PAGE_ROOT } from "../shapes";

const K = "config_backup";

const ConfigurationBackupComponent = () => {
  const { t } = useTranslation("system-settings");
  const pending = usePendingReboot();
  const [rebootBusy, setRebootBusy] = useState(false);
  const [dismissDialogOpen, setDismissDialogOpen] = useState(false);

  const handleRebootNow = async () => {
    setRebootBusy(true);
    clearPendingReboot();
    try {
      const res = await authFetch("/cgi-bin/quecmanager/system/reboot.sh", {
        method: "POST",
      });
      if (!res.ok) throw new Error(`reboot_failed: HTTP ${res.status}`);
      // Ends in the /reboot/ hand-off, which is its own confirmation.
      enterRebootFlow("config_restore");
    } catch {
      requestRebootLater("config_restore");
      setRebootBusy(false);
      toast.error(t(`${K}.reboot_failed_toast`));
    }
  };

  const handleConfirmDismiss = () => {
    clearPendingReboot();
    setDismissDialogOpen(false);
  };

  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page_title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.page_description`)}</p>
          </div>
        </div>
      </motion.div>

      {/* The deferred-reboot banner: a standing condition, so no X. Dismiss is
          an explicit action behind a confirm, because the reminder lives only
          in this browser and would otherwise outlive a reboot done elsewhere. */}
      {pending ? (
        <Banner
          role="deferred-reboot"
          title={t(`${K}.pending_reboot_title`)}
          description={t(`${K}.pending_reboot_description`)}
          action={
            <>
              <button
                type="button"
                className={bannerActionVariants({ tone: "on-warning" })}
                onClick={() => setDismissDialogOpen(true)}
                disabled={rebootBusy}
              >
                {t(`${K}.dismiss_button`)}
              </button>
              <button
                type="button"
                className={bannerActionVariants({ tone: "warning" })}
                onClick={handleRebootNow}
                disabled={rebootBusy}
              >
                {rebootBusy ? t(`${K}.rebooting_button`) : t(`${K}.reboot_now_button`)}
              </button>
            </>
          }
        />
      ) : null}

      <AlertDialog open={dismissDialogOpen} onOpenChange={setDismissDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.dismiss_dialog_title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.dismiss_dialog_description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(`${K}.dismiss_keep`)}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDismiss}>
              {t(`${K}.dismiss_confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className={CARD_GRID}>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <ConfigBackupCard />
        </motion.div>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <RestoreConfigBackupCard />
        </motion.div>
      </div>
    </motion.div>
  );
};

export default ConfigurationBackupComponent;
