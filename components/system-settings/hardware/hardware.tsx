"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import HostAtPortsCard from "@/components/system-settings/at-engine/host-at-ports-card";
import IpaOffloadCard from "@/components/system-settings/ipa-offload/ipa-offload-card";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { CARD_CELL, CARD_GRID, PAGE_HEAD, PAGE_ROOT } from "../shapes";

const K = "hardware.page";

// A symmetric pair: both cards are a decision row, a path diagram and a footer,
// and each nominates its row group as the slack absorber in every state.
const HardwareSettings = () => {
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
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.description`)}</p>
          </div>
        </div>
      </motion.div>

      {/* A nested container: it inherits `visible` from the root and must not
          declare initial/animate. */}
      <motion.div className={CARD_GRID} variants={staggerContainer}>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <IpaOffloadCard />
        </motion.div>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <HostAtPortsCard />
        </motion.div>
      </motion.div>
    </motion.div>
  );
};

export default HardwareSettings;
