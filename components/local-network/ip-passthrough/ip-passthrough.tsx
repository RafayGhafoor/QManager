"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { RefreshCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useMotionReduced } from "@/components/motion-preference";
import { useIpPassthrough } from "@/hooks/use-ip-passthrough";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import IPPassthroughCard from "./ip-passthrough-card";
import StatusStrip from "./status-strip";
import { PAGE_HEAD, PAGE_ROOT, PILL_GLYPH } from "./shapes";

// The shell owns the page's one read. The cascade root declares initial/animate once;
// children carry only `variants`, or they detach from its clock.

const K = "ippt";

const IPPassthroughComponent = () => {
  const { t } = useTranslation("local-network");
  const reduced = useMotionReduced();

  const {
    passthroughMode,
    targetMac,
    ipptNat,
    usbMode,
    dnsProxy,
    isLoading,
    isSaving,
    error,
    saveSettings,
    refresh,
  } = useIpPassthrough();

  // A read that failed and left nothing behind, as distinct from still loading.
  const failed = passthroughMode === null && !isLoading && error !== null;

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
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page.title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.page.description`)}</p>
          </div>
          <div className={PAGE_HEAD.ACTIONS}>
            {/* `refresh(silent?)`: a click event must never reach it. */}
            <Button
              type="button"
              variant="tonal-neutral"
              size="action"
              onClick={() => refresh()}
              disabled={isSaving || isLoading}
              aria-label={t(`${K}.header.refresh`)}
              className="group/refresh gap-0"
            >
              <RefreshCcwIcon
                className={cn(PILL_GLYPH, isLoading && "motion-safe:animate-spin")}
                aria-hidden
              />
              {/* Icon-only at rest; the label unfolds on hover or focus, as Band Locking's buttons do. */}
              <span
                aria-hidden
                className={cn(
                  "grid grid-cols-[0fr] group-hover/refresh:grid-cols-[1fr] group-focus-visible/refresh:grid-cols-[1fr]",
                  !reduced &&
                    "transition-[grid-template-columns] duration-[var(--duration-standard)] ease-[var(--ease-standard)]",
                )}
              >
                <span className="min-w-0 overflow-hidden">
                  <span className="block pl-2 whitespace-nowrap">
                    {t(`${K}.header.refresh`)}
                  </span>
                </span>
              </span>
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <StatusStrip
          mode={passthroughMode}
          failed={failed}
          onRetry={() => refresh()}
        />
      </motion.div>

      <motion.div variants={staggerItem}>
        <IPPassthroughCard
          passthroughMode={passthroughMode}
          targetMac={targetMac}
          ipptNat={ipptNat}
          usbMode={usbMode}
          dnsProxy={dnsProxy}
          isLoading={isLoading}
          isSaving={isSaving}
          failed={failed}
          saveSettings={saveSettings}
        />
      </motion.div>
    </motion.div>
  );
};

export default IPPassthroughComponent;
