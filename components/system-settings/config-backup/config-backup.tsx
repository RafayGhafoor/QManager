"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import ConfigBackupCard from "./config-backup-card";
import RestoreConfigBackupCard from "./restore-backup-card";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { CARD_CELL, CARD_GRID, PAGE_HEAD, PAGE_ROOT } from "../shapes";

const K = "config_backup";

const ConfigurationBackupComponent = () => {
  const { t } = useTranslation("system-settings");
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
