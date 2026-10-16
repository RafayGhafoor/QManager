"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import { CellularPageHeader } from "@/components/cellular/page-header";
import { useSmsForwarding } from "@/hooks/use-sms-forwarding";
import { staggerContainer, staggerItem } from "@/lib/motion";
import SmsForwardingCard from "./sms-forwarding-card";
import DeliveryHealthCard from "./delivery-health-card";

// =============================================================================
// ForwardingCenter — the page shell for /cellular/sms/forwarding
// =============================================================================
// Status first: the health card (what the relay is doing) leads, and the
// settings card (what changes it) follows. Side by side on a wide column
// (container query, never a viewport breakpoint), stacked with status on top
// below that.
//
// The hook is lifted here so both cards share one fetch and one 20 s poll; two
// hook calls would land their polls at different instants and show a saved
// change on one card a cycle before the other. A failed first read replaces
// both cards with one condition screen rather than two copies of it.
// =============================================================================

const ForwardingCenterComponent = () => {
  const { t } = useTranslation("cellular");
  const fwd = useSmsForwarding();
  const readFailed = !fwd.isLoading && !fwd.data;

  return (
    <div className="@container/main mx-auto flex flex-col gap-5 p-2">
      <CellularPageHeader
        title={t("sms.forwarding.page.title")}
        description={t("sms.forwarding.page.description")}
      />

      {readFailed ? (
        <ConditionScreen
          tone="destructive"
          glyph="error"
          ariaRole="alert"
          title={t("sms.forwarding.sms.error_load")}
          description={fwd.error ?? t("sms.forwarding.errors.load_failed")}
          onRetry={() => fwd.refresh()}
          retryLabel={t("actions.retry", { ns: "common" })}
        />
      ) : (
        <motion.div
          className="grid grid-cols-1 items-stretch gap-4 @4xl/main:grid-cols-2"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={staggerItem} className="h-full">
            <DeliveryHealthCard fwd={fwd} />
          </motion.div>
          <motion.div variants={staggerItem} className="h-full">
            <SmsForwardingCard fwd={fwd} />
          </motion.div>
        </motion.div>
      )}
    </div>
  );
};

export default ForwardingCenterComponent;
