"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import HostAtPortsCard from "@/components/system-settings/at-engine/host-at-ports-card";
import DeviceHardwareCard from "@/components/system-settings/hardware/device-hardware-card";
import IpaOffloadCard from "@/components/system-settings/ipa-offload/ipa-offload-card";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { CARD_CELL, CARD_GRID, CARD_SPAN, PAGE_HEAD, PAGE_ROOT } from "../shapes";

const K = "hardware.page";

// A symmetric pair of vendor toggles, plus the device's own hardware above
// them: on a SKU with neither vendor service the pair honestly reads "Not on
// this modem", and that card is what keeps the page from being a dead end.
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
        {/* Full width above the pair: a card with no row-mate. */}
        <motion.div variants={staggerItem} className={cn(CARD_CELL, CARD_SPAN)}>
          <DeviceHardwareCard />
        </motion.div>
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
