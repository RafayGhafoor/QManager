"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import SSHPasswordCard from "@/components/system-settings/ssh-password-card";
import WebPortCard from "@/components/system-settings/web-port/web-port-card";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { CARD_CELL, CARD_STACK, PAGE_HEAD, PAGE_ROOT } from "../shapes";

const K = "device_access.page";

// A single-column stack: the two cards share a question, not a shape, so each
// recomposes inside its own card instead of being paired by symmetry.
const DeviceAccessSettings = () => {
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
      <motion.div className={CARD_STACK} variants={staggerContainer}>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <SSHPasswordCard />
        </motion.div>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <WebPortCard />
        </motion.div>
      </motion.div>
    </motion.div>
  );
};

export default DeviceAccessSettings;
