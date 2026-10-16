"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { staggerContainer, staggerItem } from "@/lib/motion";
import CustomDNSCard from "./custom-dns-card";
import { PAGE_HEAD, PAGE_ROOT } from "./shapes";

/** Full-width page: the one card recomposes on a wide container, never a `max-w-*` cap. */
const CustomDNSComponent = () => {
  const { t } = useTranslation("local-network");
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
            <h1 className={PAGE_HEAD.TITLE}>{t("dns.page_title")}</h1>
            <p className={PAGE_HEAD.DESC}>{t("dns.page_description")}</p>
          </div>
        </div>
      </motion.div>
      <motion.div variants={staggerItem}>
        <CustomDNSCard />
      </motion.div>
    </motion.div>
  );
};

export default CustomDNSComponent;
