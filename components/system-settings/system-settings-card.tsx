"use client";

import { useCallback, useMemo, useState } from "react";
import type * as React from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  CircleAlertIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { fieldVariants } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CardFoot } from "@/components/ui/card-foot";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type {
  SaveResult,
  SaveSettingsPayload,
  UseSystemSettingsReturn,
} from "@/hooks/use-system-settings";
import { TIMEZONES } from "@/types/system-settings";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION_PANEL,
  CONTROL_FILL,
  DELTA,
  FIELD,
  FIELD_GLYPH,
  GROUP_FILL,
  LABEL_LINE,
  NOTICE,
  ROW,
  ROW_GROUP,
  SKELETON,
} from "./shapes";

// =============================================================================
// Time & Units — the writable half of /system-settings' preferences
// =============================================================================
// Three decisions in one tonal group: the zone the whole device measures time
// against, and the two units every reading is rendered in. The zone leads
// because it is the only one of the three with a consequence beyond display.
//
// The always-visible clock readout lives on the page's status band, not here.
// What this card keeps is the FAILURE case — the zone was saved but never
// reached the live clock — which is a fact about this card's own write.
// =============================================================================

const K = "preferences";

const TZ_LABEL_ID = "preferences-timezone-label";
const TZ_LIST_ID = "preferences-timezone-list";
const TEMP_LABEL_ID = "preferences-temperature-label";
const DISTANCE_LABEL_ID = "preferences-distance-label";
const TAILSCALE_LABEL_ID = "preferences-tailscale-label";

/** The lucide check that `SegmentedField` reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

// -----------------------------------------------------------------------------

type SystemSettingsCardProps = Pick<
  UseSystemSettingsReturn,
  "settings" | "isLoading" | "isSaving" | "error" | "saveSettings" | "refresh"
>;

export default function SystemSettingsCard({
  settings,
  isLoading,
  isSaving,
  error,
  saveSettings,
  refresh,
}: SystemSettingsCardProps) {
  const { t } = useTranslation("system-settings");

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.card.description`)}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY, "gap-4")}>
        {isLoading ? (
          <PreferencesSkeleton />
        ) : !settings ? (
          // No settings to show — a failed read, or an envelope carrying none.
          // The form would otherwise fill itself with its own fallbacks.
          <ConditionBlock
            tone="destructive"
            glyph={CircleAlertIcon}
            ariaRole="alert"
            title={t(`${K}.states.error_title`)}
            description={
              error
                ? t(`${K}.states.error_body_detail`, { detail: error })
                : t(`${K}.states.error_body`)
            }
            onRetry={() => refresh()}
            retryLabel={t("actions.retry", { ns: "common" })}
            className={CONDITION_PANEL.SCREEN}
          />
        ) : (
          <PreferencesForm
            settings={settings}
            isSaving={isSaving}
            error={error}
            saveSettings={saveSettings}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Loading ────────────────────────────────────────────────────────────────

/**
 * Real `ROW_GROUP` / `ROW.ROOT` boxes wearing slivers, so the skeleton's height
 * RESOLVES to the loaded row's rather than being asserted against it.
 */
function PreferencesSkeleton(): React.JSX.Element {
  return (
    <>
      <div className={cn(ROW_GROUP, GROUP_FILL)}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={ROW.ROOT}>
            <div className={ROW.TEXT}>
              <Skeleton className={cn(SKELETON.TIME.LABEL, "w-28")} />
              <Skeleton className={cn(SKELETON.TIME.CONSEQUENCE, "w-full")} />
              {/* The zone row's consequence wraps to two lines at real widths. */}
              {i === 0 ? (
                <Skeleton className={cn(SKELETON.TIME.CONSEQUENCE_2, "w-2/3")} />
              ) : null}
            </div>
            <div className={cn(ROW.CONTROL, CONTROL_FILL)}>
              <Skeleton className={SKELETON.TIME.FIELD} />
            </div>
          </div>
        ))}
      </div>
      {/* The card foot. Absent, the card grows by its height plus the gap. */}
      <CardFoot
        liveStatus={false}
        aria-hidden="true"
        actions={<Skeleton className={SKELETON.TIME.ACTION} />}
      />
    </>
  );
}

// ─── Form ───────────────────────────────────────────────────────────────────

interface PreferencesFormProps {
  settings: UseSystemSettingsReturn["settings"];
  isSaving: boolean;
  error: string | null;
  saveSettings: (payload: SaveSettingsPayload) => Promise<SaveResult>;
}

function PreferencesForm({
  settings,
  isSaving,
  error,
  saveSettings,
}: PreferencesFormProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const { saved, markSaved } = useSaveFlash();

  const [prevSettings, setPrevSettings] = useState(settings);
  const [tempUnit, setTempUnit] = useState<"celsius" | "fahrenheit">(
    settings?.temp_unit ?? "celsius",
  );
  const [distanceUnit, setDistanceUnit] = useState<"km" | "miles">(
    settings?.distance_unit ?? "km",
  );
  const [zonename, setZonename] = useState(settings?.zonename ?? "UTC");
  const [timezone, setTimezone] = useState(settings?.timezone ?? "UTC0");
  const [tzOpen, setTzOpen] = useState(false);
  // The Tailscale row saves on its own, immediately, so it is not part of the
  // draft or the dirty check.
  const [forceTs, setForceTs] = useState(
    settings?.force_tailscale_fixes ?? false,
  );
  const [tsSaving, setTsSaving] = useState(false);

  // Server -> local during render, never in an effect: a data-derived remount
  // would kill the pending `saved` flash, since the refetch and markSaved()
  // land in one React batch. `tzOpen` is popover state, deliberately not synced.
  // Field by field: the Tailscale row's own refetch must not wipe an unsaved
  // edit to a unit or the zone.
  if (settings !== prevSettings) {
    setPrevSettings(settings);
    if (settings?.temp_unit !== prevSettings?.temp_unit) {
      setTempUnit(settings?.temp_unit ?? "celsius");
    }
    if (settings?.distance_unit !== prevSettings?.distance_unit) {
      setDistanceUnit(settings?.distance_unit ?? "km");
    }
    if (
      settings?.zonename !== prevSettings?.zonename ||
      settings?.timezone !== prevSettings?.timezone
    ) {
      setZonename(settings?.zonename ?? "UTC");
      setTimezone(settings?.timezone ?? "UTC0");
    }
    if (settings?.force_tailscale_fixes !== prevSettings?.force_tailscale_fixes) {
      setForceTs(settings?.force_tailscale_fixes ?? false);
    }
  }

  const tzDirty = Boolean(
    settings &&
      (zonename !== settings.zonename || timezone !== settings.timezone),
  );
  const tempDirty = Boolean(settings && tempUnit !== settings.temp_unit);
  const distanceDirty = Boolean(
    settings && distanceUnit !== settings.distance_unit,
  );
  const isDirty = tzDirty || tempDirty || distanceDirty;
  const canSave = isDirty && !isSaving;

  const tzLabel = useMemo(
    () => TIMEZONES.find((tz) => tz.zonename === zonename)?.label,
    [zonename],
  );

  const handleTimezoneChange = useCallback((selected: string) => {
    const entry = TIMEZONES.find((tz) => tz.zonename === selected);
    if (!entry) return;
    setZonename(entry.zonename);
    setTimezone(entry.timezone);
  }, []);

  const handleDiscard = useCallback(() => {
    if (!settings) return;
    setTempUnit(settings.temp_unit);
    setDistanceUnit(settings.distance_unit);
    setZonename(settings.zonename);
    setTimezone(settings.timezone);
  }, [settings]);

  const handleSave = useCallback(async () => {
    if (!canSave) return;

    const result = await saveSettings({
      action: "save_settings",
      temp_unit: tempUnit,
      distance_unit: distanceUnit,
      timezone,
      zonename,
    });

    if (result.success) {
      markSaved();
      toast.success(t(`${K}.toast.saved`));
    } else {
      toast.error(result.message ?? t(`${K}.toast.failed`));
    }
  }, [
    canSave,
    saveSettings,
    tempUnit,
    distanceUnit,
    timezone,
    zonename,
    markSaved,
    t,
  ]);

  const handleTailscaleChange = useCallback(
    async (next: "on" | "off") => {
      const checked = next === "on";
      setForceTs(checked);
      setTsSaving(true);
      const result = await saveSettings({
        action: "save_settings",
        force_tailscale_fixes: checked,
      });
      setTsSaving(false);
      if (result.success) {
        toast.success(
          t(
            checked
              ? `${K}.rows.tailscale.toast_enabled`
              : `${K}.rows.tailscale.toast_disabled`,
          ),
        );
      } else {
        setForceTs(!checked);
        toast.error(result.message ?? t(`${K}.rows.tailscale.toast_failed`));
      }
    },
    [saveSettings, t],
  );

  const unsaved = t(`${K}.rows.unsaved`);

  return (
    <>
      {/* A failed refresh over live data says so and steps aside; it does not
          take the card down. */}
      {error ? (
        <div role="status" className={cn(NOTICE.BOX, NOTICE.STALE)}>
          <TriangleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
          <span className={NOTICE.TEXT}>{t(`${K}.states.stale`)}</span>
        </div>
      ) : null}

      {/* No `initial`/`animate`: this container is a child of the page cascade
          and must stay on the parent's clock. */}
      <motion.div
        className={cn(ROW_GROUP, GROUP_FILL)}
        variants={staggerRows}
      >
        {/* ── Time zone ───────────────────────────────────────────────── */}
        <motion.div variants={staggerRowItem} className={ROW.ROOT}>
          <div className={ROW.TEXT}>
            <span className={LABEL_LINE}>
              <span id={TZ_LABEL_ID} className={ROW.LABEL}>
                {t(`${K}.rows.timezone.label`)}
              </span>
              <span className={cn(DELTA.ROOT, !tzDirty && DELTA.CLEAN)}>
                {unsaved}
              </span>
            </span>
            <span className={ROW.CONSEQUENCE}>
              {t(`${K}.rows.timezone.consequence`)}
            </span>
          </div>
          <div className={ROW.CONTROL}>
            <Popover open={tzOpen} onOpenChange={setTzOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  role="combobox"
                  aria-expanded={tzOpen}
                  aria-controls={TZ_LIST_ID}
                  aria-labelledby={TZ_LABEL_ID}
                  className={cn(
                    fieldVariants({ host: "container" }),
                    "flex h-[2.625rem] items-center justify-between gap-2 px-3.5",
                    FIELD,
                  )}
                >
                  <span className="truncate">
                    {tzLabel ?? t(`${K}.rows.timezone.placeholder`)}
                  </span>
                  <ChevronsUpDownIcon
                    className={cn(FIELD_GLYPH, "flex-none opacity-60")}
                    aria-hidden="true"
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent
                id={TZ_LIST_ID}
                align="end"
                className="w-(--radix-popover-trigger-width) min-w-64 rounded-field p-0"
              >
                <Command>
                  <CommandInput
                    placeholder={t(`${K}.rows.timezone.search`)}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {t(`${K}.rows.timezone.empty`)}
                    </CommandEmpty>
                    <CommandGroup>
                      {TIMEZONES.map((tz) => (
                        <CommandItem
                          key={tz.zonename}
                          value={tz.label}
                          onSelect={() => {
                            handleTimezoneChange(tz.zonename);
                            setTzOpen(false);
                          }}
                        >
                          <CheckIcon
                            className={cn(
                              "mr-2 size-4",
                              zonename === tz.zonename
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                            aria-hidden="true"
                          />
                          {tz.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </motion.div>

        {/* ── Temperature ─────────────────────────────────────────────── */}
        <motion.div variants={staggerRowItem} className={ROW.ROOT}>
          <div className={ROW.TEXT}>
            <span className={LABEL_LINE}>
              <span id={TEMP_LABEL_ID} className={ROW.LABEL}>
                {t(`${K}.rows.temperature.label`)}
              </span>
              <span className={cn(DELTA.ROOT, !tempDirty && DELTA.CLEAN)}>
                {unsaved}
              </span>
            </span>
            <span className={ROW.CONSEQUENCE}>
              {t(`${K}.rows.temperature.consequence`)}
            </span>
          </div>
          <div className={ROW.CONTROL}>
            <Select
              value={tempUnit}
              onValueChange={(v) => setTempUnit(v as "celsius" | "fahrenheit")}
            >
              <SelectTrigger
                aria-labelledby={TEMP_LABEL_ID}
                host="container"
                className={FIELD}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="celsius">
                  {t(`${K}.rows.temperature.celsius`)}
                </SelectItem>
                <SelectItem value="fahrenheit">
                  {t(`${K}.rows.temperature.fahrenheit`)}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </motion.div>

        {/* ── Distance ────────────────────────────────────────────────── */}
        <motion.div variants={staggerRowItem} className={ROW.ROOT}>
          <div className={ROW.TEXT}>
            <span className={LABEL_LINE}>
              <span id={DISTANCE_LABEL_ID} className={ROW.LABEL}>
                {t(`${K}.rows.distance.label`)}
              </span>
              <span className={cn(DELTA.ROOT, !distanceDirty && DELTA.CLEAN)}>
                {unsaved}
              </span>
            </span>
            <span className={ROW.CONSEQUENCE}>
              {t(`${K}.rows.distance.consequence`)}
            </span>
          </div>
          <div className={ROW.CONTROL}>
            <Select
              value={distanceUnit}
              onValueChange={(v) => setDistanceUnit(v as "km" | "miles")}
            >
              <SelectTrigger
                aria-labelledby={DISTANCE_LABEL_ID}
                host="container"
                className={FIELD}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="km">
                  {t(`${K}.rows.distance.km`)}
                </SelectItem>
                <SelectItem value="miles">
                  {t(`${K}.rows.distance.miles`)}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </motion.div>

        {/* ── Force Tailscale Fixes ───────────────────────────────────── */}
        <motion.div variants={staggerRowItem} className={ROW.ROOT}>
          <div className={ROW.TEXT}>
            <span id={TAILSCALE_LABEL_ID} className={ROW.LABEL}>
              {t(`${K}.rows.tailscale.label`)}
            </span>
            <span className={ROW.CONSEQUENCE}>
              {t(`${K}.rows.tailscale.consequence`)}
            </span>
          </div>
          <div className={ROW.CONTROL}>
            <SegmentedField
              value={forceTs ? "on" : "off"}
              onValueChange={(next) => void handleTailscaleChange(next)}
              options={[
                { value: "off", label: t("state.off", { ns: "common" }) },
                { value: "on", label: t("state.on", { ns: "common" }) },
              ]}
              ariaLabel={t(`${K}.rows.tailscale.label`)}
              disabled={tsSaving}
              breakpoint="never"
              glyph={renderCheckGlyph}
            />
          </div>
        </motion.div>
      </motion.div>

      {/* Each row carries its own unsaved marker; the foot only commits. */}
      <CardFoot
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={handleDiscard}
              disabled={!isDirty || isSaving}
            >
              {t("actions.discard", { ns: "common" })}
            </Button>
            <SaveButton
              onClick={handleSave}
              isSaving={isSaving}
              saved={saved}
              label={t(`${K}.card.save`)}
              disabled={!canSave}
              size="action"
            />
          </>
        }
      />
    </>
  );
}
