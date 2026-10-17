"use client";

import React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { useCurrentSettings } from "@/hooks/use-current-settings";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { DUR, EASE_STANDARD } from "@/lib/motion";
import ProfileInputComponent from "./profile-input";
import ProfileViewComponent from "./profile-view";

// =============================================================================
// Custom SIM Profiles — coordinator
// =============================================================================
// One card per view: the REGISTRY (every saved profile) or the EDITOR (one
// profile, new or existing), never both side by side. The editor commits from
// its CardFoot and returns here on save or cancel.
//
// One `useSimProfiles` instance is shared by both views so a save refreshes
// the registry it returns to. `useCurrentSettings` is fetched once: its live
// ICCID drives the registry's SIM-mismatch chip and the editor's Load from SIM.
// =============================================================================

type View = { kind: "registry" } | { kind: "editor"; id: string | null };

const CustomProfileComponent = () => {
  const { t } = useTranslation("cellular");

  const sim = useSimProfiles();
  const currentSettings = useCurrentSettings(true);
  const [view, setView] = React.useState<View>({ kind: "registry" });

  const toRegistry = () => setView({ kind: "registry" });

  return (
    <div className="@container/main mx-auto flex flex-col gap-5 p-2">
      <CellularPageHeader
        title={t("custom_profiles.page.title")}
        description={t("custom_profiles.page.description")}
      />

      {/* The registry stays mounted (hidden) while the editor is open, so
          returning to it never re-runs the detail prefetch and its skeleton. */}
      <div hidden={view.kind === "editor"}>
        <ProfileViewComponent
          sim={sim}
          currentIccid={currentSettings.settings?.iccid ?? null}
          onEdit={(id) => setView({ kind: "editor", id })}
          onAdd={() => setView({ kind: "editor", id: null })}
        />
      </div>

      {view.kind === "editor" ? (
        <motion.div
          key={view.id ?? "new"}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.quick, ease: EASE_STANDARD }}
        >
          <ProfileInputComponent
            sim={sim}
            currentSettings={currentSettings}
            editingId={view.id}
            onDone={toRegistry}
            onCancel={toRegistry}
          />
        </motion.div>
      ) : null}
    </div>
  );
};

export default CustomProfileComponent;
