"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConditionScreen } from "@/components/cellular/condition-screen";
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
import { ExpandButton } from "@/components/ui/expand-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveProfile } from "@/hooks/use-active-profile";
import { useConnectionScenarios } from "@/hooks/use-connection-scenarios";
import { staggerRows } from "@/lib/motion";
import {
  OPTIMIZATION_TOKENS,
  bandsToInput,
  inputToBands,
  optimizationLabelKey,
} from "@/types/connection-scenario";
import { ActiveConfigCard } from "./active-config-card";
import {
  EMPTY_SCENARIO_DRAFT,
  ScenarioDialog,
  type ScenarioDraft,
} from "./scenario-dialog";
import {
  SCENARIO_GRID,
  SCENARIO_TILE_SHAPE,
  ScenarioItem,
  type Scenario,
} from "./scenario-item";
import { DEFAULT_SCENARIO_ICON_ID, resolveScenarioIcon } from "./scenario-icons";

// =============================================================================
// ConnectionScenariosCard — the page body: Scenarios card + Selected card
// =============================================================================
// Two cards. The Scenarios card lists every scenario as a tile (built-ins,
// then customs) with "New scenario" in its header; selecting a tile only views
// it. The Selected-scenario card shows that tile's configuration and commits
// it from its CardFoot (Activate, plus Edit / Delete for customs). One dialog
// adds and edits.
//
// Invariants: activation is explicit and a same-id activate is a no-op;
// built-ins are mode-only; the active profile's schedule lock withholds
// Activate (the backend also refuses with `scenario_locked_by_schedule`);
// the page opens Add via `openAddSignal` / `autoOpenAddDialog`. A custom
// scenario persists its identity glyph as an `icon` id (B5.25) and its
// optimization as a stable token or the user's own words (B5.26); neither the
// retired `gradient` nor the display-language `config.mode` is sent any more.
// Never reboots.
// =============================================================================

/** Deep-link action (`?action=create-scenario`) the page maps to Add. */
export const SCENARIO_CREATE_ACTION = "create-scenario";

export interface ConnectionScenariosCardProps {
  /** Each increment opens the Add dialog. */
  openAddSignal?: number;
  /** Open the Add dialog once on mount (deep link). */
  autoOpenAddDialog?: boolean;
  /** Epoch ms of the next scheduled start per scenario id. */
  nextFireByScenarioId?: Record<string, number>;
  /** The active profile's schedule owns scenario selection. */
  radioOwnedByProfile?: boolean;
  ownerProfileName?: string | null;
  /** The page holds every card in skeleton until all are ready. */
  holdSkeleton?: boolean;
  onLocalReadyChange?: (ready: boolean) => void;
}

const ConnectionScenariosCard = ({
  openAddSignal,
  autoOpenAddDialog = false,
  nextFireByScenarioId,
  radioOwnedByProfile,
  ownerProfileName,
  holdSkeleton = false,
  onLocalReadyChange,
}: ConnectionScenariosCardProps = {}) => {
  const { t, i18n } = useTranslation("cellular");

  const modeOptions = useMemo(
    () => [
      { value: "AUTO", label: t("scenarios.mode_option_auto") },
      { value: "LTE", label: t("scenarios.mode_option_lte") },
      { value: "NR5G", label: t("scenarios.mode_option_nrsa") },
      { value: "LTE:NR5G", label: t("scenarios.mode_option_nrsa_nsa") },
    ],
    [t],
  );
  const modeLabel = (value: string) =>
    modeOptions.find((o) => o.value === value)?.label ?? value;
  // A token the app wrote is translated; the user's own words print verbatim.
  const optimizationLabel = (value: string) => {
    const key = optimizationLabelKey(value);
    return key ? t(key) : value;
  };

  const defaultScenarios = useMemo<Scenario[]>(
    () => [
      {
        id: "balanced",
        name: t("scenarios.default_balanced_name"),
        description: t("scenarios.default_balanced_description"),
        glyph: "bolt",
        isDefault: true,
        config: {
          atModeValue: "AUTO",
          optimization: OPTIMIZATION_TOKENS.balanced,
          lte_bands: "",
          nsa_nr_bands: "",
          sa_nr_bands: "",
        },
      },
      {
        id: "gaming",
        name: t("scenarios.default_gaming_name"),
        description: t("scenarios.default_gaming_description"),
        glyph: "sports_esports",
        isDefault: true,
        config: {
          atModeValue: "NR5G",
          optimization: OPTIMIZATION_TOKENS.latency,
          lte_bands: "",
          nsa_nr_bands: "",
          sa_nr_bands: "",
        },
      },
      {
        id: "streaming",
        name: t("scenarios.default_streaming_name"),
        description: t("scenarios.default_streaming_description"),
        glyph: "videocam",
        isDefault: true,
        config: {
          atModeValue: "LTE:NR5G",
          optimization: OPTIMIZATION_TOKENS.throughput,
          lte_bands: "",
          nsa_nr_bands: "",
          sa_nr_bands: "",
        },
      },
    ],
    [t],
  );

  const {
    activeScenarioId,
    customScenarios: stored,
    isLoading: hookLoading,
    isActivating,
    error,
    activateScenario,
    saveCustomScenario,
    deleteCustomScenario,
    refresh,
  } = useConnectionScenarios();
  const profile = useActiveProfile();
  // Props from the page win; without them fall back to the active-profile hook.
  const scheduleLocked = radioOwnedByProfile ?? profile.scheduleLocked;
  const nextChangeAt = profile.nextChangeAt;
  const lockProfileName =
    ownerProfileName !== undefined ? ownerProfileName : profile.lockProfileName;
  const isLoading = hookLoading || holdSkeleton;

  useEffect(() => {
    onLocalReadyChange?.(!hookLoading);
  }, [hookLoading, onLocalReadyChange]);

  const formatFire = (ms: number) =>
    new Date(ms).toLocaleTimeString(i18n.language, {
      hour: "2-digit",
      minute: "2-digit",
    });

  const scenarios = useMemo<Scenario[]>(
    () => [
      ...defaultScenarios,
      ...stored.map((s) => ({
        ...s,
        glyph: resolveScenarioIcon(s.icon),
        isDefault: false,
      })),
    ],
    [defaultScenarios, stored],
  );

  // --- Selection (view only) -------------------------------------------------
  // Follows the active scenario when it changes, adjusted during render (never
  // setState in an effect). An unknown id falls back to the first built-in.
  const [selectedId, setSelectedId] = useState(activeScenarioId);
  const [prevActive, setPrevActive] = useState(activeScenarioId);
  if (prevActive !== activeScenarioId) {
    setPrevActive(activeScenarioId);
    setSelectedId(activeScenarioId);
  }
  const selected =
    scenarios.find((s) => s.id === selectedId) ??
    (isLoading ? undefined : scenarios[0]);
  const isSelectedActive = selected?.id === activeScenarioId;

  // --- Dialogs ---------------------------------------------------------------
  const [dialog, setDialog] = useState<
    { mode: "add" } | { mode: "edit"; id: string } | null
  >(autoOpenAddDialog ? { mode: "add" } : null);
  const [dialogSeq, setDialogSeq] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Scenario | null>(null);

  const openAdd = () => {
    setDialogSeq((n) => n + 1);
    setDialog({ mode: "add" });
  };

  // Each increment of `openAddSignal` opens Add, adjusted during render.
  const [seenSignal, setSeenSignal] = useState(openAddSignal ?? 0);
  if ((openAddSignal ?? 0) !== seenSignal) {
    setSeenSignal(openAddSignal ?? 0);
    setDialogSeq((n) => n + 1);
    setDialog({ mode: "add" });
  }

  const dialogInitial: ScenarioDraft =
    dialog?.mode === "edit" && selected && !selected.isDefault
      ? {
          name: selected.name,
          description: selected.description,
          mode: selected.config.atModeValue,
          optimization: optimizationLabel(selected.config.optimization),
          icon: selected.icon ?? DEFAULT_SCENARIO_ICON_ID,
          lteBands: bandsToInput(selected.config.lte_bands),
          saBands: bandsToInput(selected.config.sa_nr_bands),
          nsaBands: bandsToInput(selected.config.nsa_nr_bands),
        }
      : EMPTY_SCENARIO_DRAFT;

  // --- Mutations: one toast each, from the returned result -------------------
  const handleActivate = async () => {
    if (!selected || isActivating || isSelectedActive) return;
    if (scheduleLocked) {
      toast.error(t("scenarios.schedule_lock.blocked_toast"));
      return;
    }
    const result = await activateScenario(selected.id, selected.config);
    if (result.ok) {
      toast.success(
        t("scenarios.activation_toast.success", { name: selected.name }),
      );
    } else {
      toast.error(result.error);
    }
  };

  const handleSubmit = async (draft: ScenarioDraft) => {
    const editing = dialog?.mode === "edit" ? selected : undefined;
    // An untouched optimization field keeps its stored token, so a translated
    // label shown in the dialog is never written back as the value.
    const typedOptimization = draft.optimization.trim();
    const optimization = editing
      ? typedOptimization === optimizationLabel(editing.config.optimization)
        ? editing.config.optimization
        : typedOptimization
      : OPTIMIZATION_TOKENS.custom;
    setIsSaving(true);
    const result = await saveCustomScenario({
      ...(editing ? { id: editing.id } : {}),
      name: draft.name.trim(),
      description:
        draft.description.trim() ||
        t("scenarios.add_dialog.fields.preview_placeholder"),
      icon: draft.icon,
      config: {
        atModeValue: draft.mode,
        optimization,
        lte_bands: inputToBands(draft.lteBands),
        nsa_nr_bands: inputToBands(draft.nsaBands),
        sa_nr_bands: inputToBands(draft.saBands),
      },
    });
    setIsSaving(false);

    if (result.ok) {
      setDialog(null);
      if (!editing && result.id) setSelectedId(result.id);
      toast.success(
        t(editing ? "scenarios.edit_dialog.toast.success" : "scenarios.add_dialog.toast.success"),
      );
    } else {
      toast.error(result.error);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    const result = await deleteCustomScenario(target.id);
    if (result.ok) {
      if (selectedId === target.id) {
        setSelectedId(
          activeScenarioId === target.id ? defaultScenarios[0].id : activeScenarioId,
        );
      }
      toast.success(t("scenarios.deletion_toast.success"));
    } else {
      toast.error(result.error);
    }
  };

  const readFailed = !isLoading && error !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* --- Scenarios ------------------------------------------------------ */}
      <Card className="@container/card">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-48 flex-1 flex-col gap-1.5">
              <CardTitle>{t("scenarios.list_card.title")}</CardTitle>
              <CardDescription>{t("scenarios.list_card.description")}</CardDescription>
            </div>
            <ExpandButton
              variant="tonal"
              onClick={openAdd}
              disabled={isLoading}
              icon={<MaterialSymbol name="add" size={18} />}
              label={t("scenarios.add_button.label")}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className={SCENARIO_GRID}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className={`${SCENARIO_TILE_SHAPE} bg-surface-container`} />
              ))}
            </div>
          ) : readFailed ? (
            <ConditionScreen
              tone="destructive"
              glyph="error"
              ariaRole="alert"
              title={t("scenarios.list_card.error_title")}
              description={error ?? ""}
              onRetry={refresh}
              retryLabel={t("actions.retry", { ns: "common" })}
              className="rounded-tile py-10"
            />
          ) : (
            <motion.div
              className={SCENARIO_GRID}
              variants={staggerRows}
              initial="hidden"
              animate="visible"
            >
              {scenarios.map((scenario) => (
                <ScenarioItem
                  key={scenario.id}
                  scenario={scenario}
                  isActive={activeScenarioId === scenario.id}
                  isSelected={selected?.id === scenario.id}
                  modeLabel={modeLabel(scenario.config.atModeValue)}
                  onSelect={setSelectedId}
                  nextAt={
                    nextFireByScenarioId?.[scenario.id] !== undefined
                      ? formatFire(nextFireByScenarioId[scenario.id])
                      : undefined
                  }
                />
              ))}
            </motion.div>
          )}
        </CardContent>
      </Card>

      {/* --- Selected scenario ------------------------------------------------ */}
      {readFailed ? null : (
        <ActiveConfigCard
          scenario={selected}
          modeLabel={selected ? modeLabel(selected.config.atModeValue) : ""}
          optimizationLabel={selected ? optimizationLabel(selected.config.optimization) : ""}
          isActive={isSelectedActive}
          isActivating={isActivating}
          isLoading={isLoading}
          onEdit={() => {
            if (!selected || selected.isDefault) return;
            setDialogSeq((n) => n + 1);
            setDialog({ mode: "edit", id: selected.id });
          }}
          onDelete={() => selected && !selected.isDefault && setPendingDelete(selected)}
          onActivate={handleActivate}
          scheduleLocked={scheduleLocked}
          nextChangeAt={nextChangeAt}
          ownerProfileName={lockProfileName}
        />
      )}

      <ScenarioDialog
        key={dialogSeq}
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        mode={dialog?.mode ?? "add"}
        initial={dialogInitial}
        modeOptions={modeOptions}
        isSaving={isSaving}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("scenarios.scenario_item.delete_confirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("scenarios.scenario_item.delete_confirm.description", {
                name: pendingDelete?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              {t("scenarios.scenario_item.delete_confirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ConnectionScenariosCard;
