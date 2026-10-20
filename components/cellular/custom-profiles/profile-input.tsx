"use client";

import React from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { useMotionReduced } from "@/components/motion-preference";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { SegmentedField } from "@/components/ui/segmented-field";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { transitionStandard } from "@/lib/motion";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";

import type {
  ProfileFormData,
  UseSimProfilesReturn,
} from "@/hooks/use-sim-profiles";
import type { UseCurrentSettingsReturn } from "@/hooks/use-current-settings";
import { useScenarioList } from "@/hooks/use-scenario-list";
import { useApnSettings } from "@/hooks/use-apn-settings";
import type { DayOfWeek } from "@/types/sim-profile";
import {
  MNO_PRESETS,
  MNO_CUSTOM_ID,
  getMnoPreset,
} from "@/constants/mno-presets";

// -----------------------------------------------------------------------------
// Add / Edit profile form — wired to the backend via the shared useSimProfiles.
// -----------------------------------------------------------------------------
// The same card serves create and edit: when the coordinator hands an
// `editingId`, the form loads that profile and flips its title to "Edit
// Profile". Fields are controlled so Submit can emit the flat ProfileFormData
// that save.sh expects (APN keys top-level; the backend nests them into
// settings.apn). The Scenario tab is driven by real scenario ids from
// useScenarioList — the backend validates that scenario refs are known.
const MAX_WINDOWS = 2;

// Wizard tab order — the "Next" button walks the user forward through these.
const TAB_ORDER = ["identity", "network", "scenario", "review"] as const;

// One wizard step. Slides in from the direction of travel (+ forward, - back)
// and fades, on the standard transition. Reduced motion shows it instantly.
const WizardPanel = ({
  dir,
  children,
}: {
  dir: number;
  children: React.ReactNode;
}) => {
  const reduceMotion = useMotionReduced();
  return (
    <motion.div
      className="max-w-3xl"
      initial={reduceMotion ? false : { opacity: 0, x: dir * 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={reduceMotion ? { duration: 0 } : transitionStandard}
    >
      {children}
    </motion.div>
  );
};

// Sentinel value for the "+ Create scenario" Select item. Picking it hands off
// to the page (`onCreateScenario`), which closes the wizard and opens the
// scenarios card's New dialog on the same page.
const CREATE_SCENARIO_VALUE = "__create_scenario__";

export type WizardTab = (typeof TAB_ORDER)[number];

/** What a successful save reports back to the page. */
export interface ProfileSaveOutcome {
  /** True when an APN, CID, PDP, IMEI, TTL or HL field changed on an edit:
   *  those only reach the modem on the next activation. */
  networkChanged: boolean;
  /** The backend re-armed the active profile's schedule on this save. */
  scheduleRearmed: boolean;
}

/** The network half of a draft key, for `networkChanged`. */
function networkKey(key: string | null): string {
  if (!key) return "";
  const a = JSON.parse(key) as unknown[];
  return JSON.stringify(a.slice(3, 9));
}

// Synthetic "Custom" value for the APN Profiles select — shown automatically
// when the typed APN matches none of the saved slots. Picking it is a no-op
// (the APN Name field stays the source of truth); it exists so the trigger
// reads "Custom" instead of going blank while the user types a custom APN.
const APN_CUSTOM_VALUE = "__custom__";

interface ScheduleWindow {
  id: number;
  scenario: string;
  start: string;
  end: string;
}

interface ProfileInputProps {
  sim: UseSimProfilesReturn;
  currentSettings: UseCurrentSettingsReturn;
  /** null = new profile, otherwise the profile being edited */
  editingId: string | null;
  /** Called after a successful save (the page closes the wizard). */
  onDone: (outcome: ProfileSaveOutcome) => void;
  /** Called by Cancel (the page closes the wizard, draft dropped). */
  onCancel: () => void;
  /** The step the wizard opens on ("scenario" from Edit schedule). */
  initialTab?: WizardTab;
  /** "+ Create scenario" in the default-scenario Select. */
  onCreateScenario?: () => void;
}

/**
 * Stable fingerprint of the editable draft (window ids excluded). Compared with
 * the loaded baseline to decide whether the draft differs from what is saved.
 */
function draftKey(f: {
  name: string;
  simIccid: string;
  mnoId: string;
  apn: string;
  pdp: string;
  cid: string;
  imei: string;
  ttl: string;
  hl: string;
  defaultScenario: string;
  scheduleEnabled: boolean;
  windows: { scenario: string; start: string; end: string }[];
}): string {
  return JSON.stringify([
    f.name,
    f.simIccid,
    f.mnoId,
    f.apn,
    f.pdp,
    f.cid,
    f.imei,
    f.ttl,
    f.hl,
    f.defaultScenario,
    f.scheduleEnabled,
    f.windows.map((w) => [w.scenario, w.start, w.end]),
  ]);
}

// UI PDP token <-> backend PDP token.
const PDP_TO_BACKEND: Record<string, string> = {
  ipv4: "IP",
  ipv6: "IPV6",
  ipv4v6: "IPV4V6",
};
const PDP_FROM_BACKEND: Record<string, string> = {
  IP: "ipv4",
  IPV6: "ipv6",
  IPV4V6: "ipv4v6",
};
const PDP_DISPLAY: Record<string, string> = {
  ipv4: "IPv4",
  ipv6: "IPv6",
  ipv4v6: "IPv4 & IPv6",
};

/** Resolve a stored MNO label back to its preset id for the Select. */
function mnoIdForLabel(label: string): string {
  return MNO_PRESETS.find((p) => p.label === label)?.id ?? MNO_CUSTOM_ID;
}

const ProfileInputComponent = ({
  sim,
  currentSettings,
  editingId,
  onDone,
  onCancel,
  initialTab = "identity",
  onCreateScenario,
}: ProfileInputProps) => {
  const { t } = useTranslation("cellular");
  const { scenarios, nameForId } = useScenarioList();
  const savedApn = useApnSettings();

  const [tab, setTab] = React.useState<string>(initialTab);
  const [tabDir, setTabDir] = React.useState(1);
  const [submitting, setSubmitting] = React.useState(false);
  const [attempted, setAttempted] = React.useState(false);
  const [baseline, setBaseline] = React.useState<string | null>(null);
  const { saved, markSaved } = useSaveFlash();
  const formId = React.useId();
  const reduceMotion = useMotionReduced();

  // Route every tab change through here so the wizard panel knows which way it
  // travelled (forward from Next / a later tab, back from an earlier tab or an
  // Edit jump on Review). Direction drives the slide-in offset sign.
  const changeTab = React.useCallback(
    (next: string) => {
      setTabDir(
        TAB_ORDER.indexOf(next as (typeof TAB_ORDER)[number]) >=
          TAB_ORDER.indexOf(tab as (typeof TAB_ORDER)[number])
          ? 1
          : -1,
      );
      setTab(next);
    },
    [tab],
  );

  // --- Identity -------------------------------------------------------------
  const [name, setName] = React.useState("");
  const [simIccid, setSimIccid] = React.useState("");
  const [mnoId, setMnoId] = React.useState<string>(MNO_CUSTOM_ID);

  // --- Network --------------------------------------------------------------
  const [apn, setApn] = React.useState("");
  const [pdp, setPdp] = React.useState("ipv4v6");
  const [cid, setCid] = React.useState("1");
  const [imei, setImei] = React.useState("");
  const [ttl, setTtl] = React.useState("");
  const [hl, setHl] = React.useState("");

  // --- Scenario -------------------------------------------------------------
  const [defaultScenario, setDefaultScenario] = React.useState("balanced");
  const [scheduleEnabled, setScheduleEnabled] = React.useState(false);
  const [windows, setWindows] = React.useState<ScheduleWindow[]>([]);
  const nextId = React.useRef(1);

  // --- Verizon brick-guard + Load-from-SIM ----------------------------------
  const [verizonDialogOpen, setVerizonDialogOpen] = React.useState(false);
  const pendingMnoRef = React.useRef<string>(MNO_CUSTOM_ID);
  const [loadingSim, setLoadingSim] = React.useState(false);
  const loadRequestedRef = React.useRef(false);

  const isVerizon = getMnoPreset(mnoId)?.label === "Verizon";
  const atCap = windows.length >= MAX_WINDOWS;
  const isEditing = editingId !== null;
  const isReview = tab === "review";

  // An ICCID may belong to only one profile — a second profile on the same SIM
  // would make activation ambiguous. Block save when the trimmed ICCID collides
  // with another stored profile (ignore the row being edited).
  const trimmedIccid = simIccid.trim();
  const duplicateIccid =
    trimmedIccid !== "" &&
    sim.profiles.some(
      (p) => p.id !== editingId && (p.sim_iccid ?? "").trim() === trimmedIccid,
    );

  // Inline validation: required-field errors appear only after a submit
  // attempt; the duplicate-ICCID collision shows as soon as it exists.
  const nameError = attempted && name.trim() === "";
  const iccidMissing = attempted && trimmedIccid === "";
  const apnError = attempted && apn.trim() === "";

  const currentKey = draftKey({
    name,
    simIccid,
    mnoId,
    apn,
    pdp,
    cid,
    imei,
    ttl,
    hl,
    defaultScenario,
    scheduleEnabled,
    windows,
  });

  // --- Edit-mode prefill ----------------------------------------------------
  const { getProfile } = sim;
  React.useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    getProfile(editingId).then((p) => {
      if (cancelled || !p) return;
      const loaded = {
        name: p.name,
        simIccid: p.sim_iccid,
        mnoId: mnoIdForLabel(p.mno),
        apn: p.settings.apn.name,
        pdp: PDP_FROM_BACKEND[p.settings.apn.pdp_type] ?? "ipv4v6",
        cid: String(p.settings.apn.cid),
        imei: p.settings.imei,
        ttl: p.settings.ttl ? String(p.settings.ttl) : "",
        hl: p.settings.hl ? String(p.settings.hl) : "",
        defaultScenario: p.scenario.default,
        scheduleEnabled: p.scenario.schedule.enabled,
        windows: p.scenario.schedule.blocks.map((b) => ({
          scenario: b.scenario,
          start: b.start,
          end: b.end,
        })),
      };
      setName(loaded.name);
      setSimIccid(loaded.simIccid);
      setMnoId(loaded.mnoId);
      setApn(loaded.apn);
      setCid(loaded.cid);
      setPdp(loaded.pdp);
      setImei(loaded.imei);
      setTtl(loaded.ttl);
      setHl(loaded.hl);
      setDefaultScenario(loaded.defaultScenario);
      setScheduleEnabled(loaded.scheduleEnabled);
      setWindows(
        loaded.windows.map((b) => ({ id: nextId.current++, ...b })),
      );
      setBaseline(draftKey(loaded));
      setAttempted(false);
      setTab(initialTab);
    });
    return () => {
      cancelled = true;
    };
  }, [editingId, getProfile, initialTab]);

  // --- Window CRUD ----------------------------------------------------------
  const addWindow = () => {
    if (atCap) return;
    setWindows((prev) => [
      ...prev,
      {
        id: nextId.current++,
        scenario: defaultScenario,
        start: "22:00",
        end: "06:00",
      },
    ]);
  };

  const updateWindow = (id: number, patch: Partial<ScheduleWindow>) =>
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    );

  const removeWindow = (id: number) =>
    setWindows((prev) => prev.filter((w) => w.id !== id));

  // Default-scenario Select: the "+ Create scenario" item is a sentinel — pick
  // it to jump to Connection Scenarios with its New dialog already open, instead
  // of committing it as the selected value.
  const handleDefaultScenarioChange = (value: string) => {
    if (value === CREATE_SCENARIO_VALUE) {
      onCreateScenario?.();
      return;
    }
    setDefaultScenario(value);
  };

  // Wizard navigation: advance to the next tab (no-op on the last/Review tab).
  const goNext = () => {
    const idx = TAB_ORDER.indexOf(tab as (typeof TAB_ORDER)[number]);
    if (idx >= 0 && idx < TAB_ORDER.length - 1) changeTab(TAB_ORDER[idx + 1]);
  };

  // --- MNO preset selection (with Verizon guard) ----------------------------
  const applyMno = React.useCallback((id: string) => {
    setMnoId(id);
    const preset = getMnoPreset(id);
    if (preset) {
      setApn(preset.apn_name);
      setTtl(preset.ttl ? String(preset.ttl) : "");
      setHl(preset.hl ? String(preset.hl) : "");
      // Verizon delivers data only on PDP context 3 (MPDN). Lock CID to 3.
      if (preset.label === "Verizon") setCid("3");
    }
  }, []);

  const handleMnoChange = (id: string) => {
    const preset = getMnoPreset(id);
    if (preset?.label === "Verizon") {
      // Gate Verizon behind the brick-warning dialog before committing.
      pendingMnoRef.current = id;
      setVerizonDialogOpen(true);
      return;
    }
    applyMno(id);
  };

  // --- Load from SIM --------------------------------------------------------
  const handleLoadFromSim = () => {
    loadRequestedRef.current = true;
    setLoadingSim(true);
    currentSettings.refresh();
  };

  // Autofill once the requested current_settings query lands. Gated on
  // loadRequestedRef so the coordinator's mount fetch never autofills the form.
  const settings = currentSettings.settings;
  React.useEffect(() => {
    if (!loadRequestedRef.current || !settings) return;
    loadRequestedRef.current = false;
    if (settings.iccid) setSimIccid(settings.iccid);
    if (settings.imei) setImei(settings.imei);
    const active =
      settings.apn_profiles?.find((p) => p.cid === settings.active_cid) ??
      settings.apn_profiles?.[0];
    if (active) {
      if (active.apn) setApn(active.apn);
      setCid(String(active.cid));
      setPdp(PDP_FROM_BACKEND[active.pdp_type] ?? "ipv4v6");
    }
    toast.success(t("custom_profiles.form.loaded_from_sim"), {
      id: "profile-load-from-sim",
    });
  }, [settings, t]);

  React.useEffect(() => {
    if (!currentSettings.isLoading) setLoadingSim(false);
  }, [currentSettings.isLoading]);

  // --- APN Settings quick-pick ----------------------------------------------
  // The single stored APN setting (APN Settings page) is offered as a one-click
  // pre-fill source alongside MNO presets and Load-from-SIM. Only shown when
  // the stored APN is non-empty. Picking it copies apn + pdp_type + cid into
  // the editable fields. CID is NOT copied while Verizon is selected — that
  // field is locked to context 3 and we must not fight the brick-guard.
  const hasSavedApn =
    (savedApn.apn?.apn ?? "").trim() !== "";

  // The Select value is DERIVED from the typed APN — no separate state. If the
  // current typed APN matches the one saved APN setting, the "Use my saved APN"
  // option shows as selected; otherwise a synthetic "Custom" option is shown
  // (only once the field is non-empty), so the trigger reflects reality as the
  // user types.
  const savedApnMatch =
    hasSavedApn &&
    savedApn.apn !== null &&
    apn.trim().toLowerCase() === savedApn.apn.apn.trim().toLowerCase();
  const apnSelectValue = savedApnMatch
    ? "saved_apn"
    : apn.trim() !== ""
      ? APN_CUSTOM_VALUE
      : "";

  const apnNameField = (
    <Field>
      <FieldLabel>{t("custom_profiles.form.fields.apn_name_label")}</FieldLabel>
      <Input
        placeholder={t("custom_profiles.form.fields.apn_name_placeholder")}
        className="font-mono"
        value={apn}
        onChange={(e) => setApn(e.target.value)}
        aria-invalid={apnError || undefined}
      />
      {apnError && (
        <FieldError>
          {t("custom_profiles.form.fields.apn_name_required")}
        </FieldError>
      )}
    </Field>
  );

  const handleApnSelect = (value: string) => {
    if (value === APN_CUSTOM_VALUE) return; // display-only; keep typed APN
    if (value === "saved_apn" && savedApn.apn) {
      setApn(savedApn.apn.apn);
      if (savedApn.apn.pdp_type in PDP_DISPLAY) setPdp(savedApn.apn.pdp_type);
      // CID is NOT copied while Verizon is selected (locked to CID 3).
      if (!isVerizon) setCid(String(savedApn.apn.cid));
    }
  };

  // --- Submit / Cancel ------------------------------------------------------
  const buildFormData = (): ProfileFormData => ({
    name: name.trim(),
    mno: getMnoPreset(mnoId)?.label ?? "Custom",
    sim_iccid: simIccid.trim(),
    cid: Number(cid) || 1,
    apn_name: apn.trim(),
    pdp_type: PDP_TO_BACKEND[pdp] ?? "IPV4V6",
    imei: imei.trim(),
    ttl: Number(ttl) || 0,
    hl: Number(hl) || 0,
    scenario: {
      default: defaultScenario,
      schedule: {
        enabled: scheduleEnabled,
        blocks: scheduleEnabled
          ? windows.map((w) => ({
              start: w.start,
              end: w.end,
              days: [0, 1, 2, 3, 4, 5, 6] as DayOfWeek[],
              scenario: w.scenario,
            }))
          : [],
      },
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isReview) return;
    setAttempted(true);
    // Jump to the tab holding the first invalid field; the inline error is
    // already visible there (attempted is now true).
    if (!name.trim() || !trimmedIccid || duplicateIccid) {
      changeTab("identity");
      return;
    }
    if (!apn.trim()) {
      changeTab("network");
      return;
    }
    setSubmitting(true);
    const data = buildFormData();
    const result = isEditing
      ? await sim.updateProfile(editingId, data)
      : await sim.createProfile(data);
    setSubmitting(false);

    if (result.ok) {
      markSaved();
      const outcome: ProfileSaveOutcome = {
        networkChanged:
          isEditing && networkKey(baseline) !== networkKey(currentKey),
        scheduleRearmed: result.scheduleRearmed === true,
      };
      toast.success(
        isEditing
          ? t("custom_profiles.form.profile_updated")
          : t("custom_profiles.form.profile_added"),
      );
      onDone(outcome);
    } else {
      toast.error(result.error);
    }
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>
          {isEditing
            ? t("custom_profiles.form.edit_title")
            : t("custom_profiles.form.add_title")}
        </CardTitle>
        <CardDescription>
          {isEditing
            ? t("custom_profiles.form.edit_description_simple")
            : t("custom_profiles.form.add_description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id={formId} onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Tabs value={tab} onValueChange={changeTab} className="w-full">
              <TabsList>
                <TabsTrigger value="identity">
                  {t("custom_profiles.form.steps.identity_short")}
                </TabsTrigger>
                <TabsTrigger value="network">
                  {t("custom_profiles.form.tab_network")}
                </TabsTrigger>
                <TabsTrigger value="scenario">
                  {t("custom_profiles.form.steps.scenario_short")}
                </TabsTrigger>
                <TabsTrigger value="review">
                  {t("custom_profiles.form.steps.review_short")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="identity">
               <WizardPanel dir={tabDir}>
                <FieldSet>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <FieldDescription>
                      {t("custom_profiles.form.sections.identity_desc")}
                    </FieldDescription>
                    <Button
                      variant="tonal-neutral"
                      size="sm"
                      type="button"
                      onClick={handleLoadFromSim}
                      disabled={loadingSim}
                    >
                      {loadingSim ? (
                        <MaterialSymbol
                          name="progress_activity"
                          size={16}
                          className="motion-safe:animate-spin"
                        />
                      ) : (
                        <MaterialSymbol name="download" size={16} />
                      )}
                      {t("custom_profiles.form.load_from_sim")}
                    </Button>
                  </div>
                  <FieldGroup>
                    <Field>
                      <FieldLabel>
                        {t("custom_profiles.form.fields.profile_name_label")}
                      </FieldLabel>
                      <Input
                        placeholder={t(
                          "custom_profiles.form.fields.profile_name_placeholder",
                        )}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        aria-invalid={nameError || undefined}
                      />
                      {nameError && (
                        <FieldError>
                          {t("custom_profiles.form.fields.profile_name_required")}
                        </FieldError>
                      )}
                    </Field>
                    <Field>
                      <FieldLabel>
                        {t("custom_profiles.form.fields.sim_iccid_label")}
                      </FieldLabel>
                      <Input
                        placeholder={t(
                          "custom_profiles.form.sim_iccid_placeholder_inline",
                        )}
                        className="font-mono"
                        value={simIccid}
                        onChange={(e) => setSimIccid(e.target.value)}
                        aria-invalid={duplicateIccid || iccidMissing || undefined}
                      />
                      {duplicateIccid || iccidMissing ? (
                        <FieldError>
                          {duplicateIccid
                            ? t("custom_profiles.form.fields.sim_iccid_duplicate")
                            : t("custom_profiles.form.fields.sim_iccid_required")}
                        </FieldError>
                      ) : (
                        <FieldDescription>
                          {t("custom_profiles.form.sim_iccid_hint_inline")}
                        </FieldDescription>
                      )}
                    </Field>
                    <FieldSeparator />
                    <Field>
                      <FieldLabel>
                        {t("custom_profiles.form.fields.mno_label")}
                      </FieldLabel>
                      <Select value={mnoId} onValueChange={handleMnoChange}>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t(
                              "custom_profiles.form.fields.mno_label",
                            )}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {MNO_PRESETS.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.label}
                              </SelectItem>
                            ))}
                            <SelectItem value={MNO_CUSTOM_ID}>
                              {t("custom_profiles.form.fields.mno_custom")}
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        {t("custom_profiles.form.mno_hint")}
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                </FieldSet>
               </WizardPanel>
              </TabsContent>
              <TabsContent value="network">
               <WizardPanel dir={tabDir}>
                <FieldSet>
                  <FieldDescription>
                    {t("custom_profiles.form.network_desc")}
                  </FieldDescription>
                  <FieldGroup>
                    {hasSavedApn ? (
                      <div className="grid grid-cols-1 gap-4 @xl/card:grid-cols-2">
                        {apnNameField}
                        <Field>
                          <FieldLabel>
                            {t("custom_profiles.form.fields.reuse_apn_label")}
                          </FieldLabel>
                          <Select
                            value={apnSelectValue}
                            onValueChange={handleApnSelect}
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t(
                                  "custom_profiles.form.fields.reuse_apn_placeholder",
                                )}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {apnSelectValue === APN_CUSTOM_VALUE && (
                                  <SelectItem value={APN_CUSTOM_VALUE}>
                                    {t(
                                      "custom_profiles.form.fields.reuse_apn_custom",
                                    )}
                                  </SelectItem>
                                )}
                                <SelectItem value="saved_apn">
                                  {t("custom_profiles.form.fields.use_saved_apn", {
                                    apn: savedApn.apn?.apn ?? "",
                                  })}
                                </SelectItem>
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                    ) : (
                      apnNameField
                    )}
                    <div className="grid grid-cols-1 gap-4 @xl/card:grid-cols-2">
                      <Field>
                        <FieldLabel>
                          {t("custom_profiles.form.fields.ip_protocol_label")}
                        </FieldLabel>
                        <Select value={pdp} onValueChange={setPdp}>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                "custom_profiles.form.fields.ip_protocol_label",
                              )}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="ipv4">
                                {t("custom_profiles.form.pdp_inline.ipv4")}
                              </SelectItem>
                              <SelectItem value="ipv6">
                                {t("custom_profiles.form.pdp_inline.ipv6")}
                              </SelectItem>
                              <SelectItem value="ipv4v6">
                                {t("custom_profiles.form.pdp_inline.dual")}
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>

                      <Field>
                        <FieldLabel>
                          {t("custom_profiles.form.fields.cid_label")}
                        </FieldLabel>
                        <Select
                          value={cid}
                          onValueChange={setCid}
                          disabled={isVerizon}
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                "custom_profiles.form.fields.cid_label",
                              )}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="1">
                                {t("custom_profiles.form.cid_default_option")}
                              </SelectItem>
                              <SelectItem value="2">CID 2</SelectItem>
                              <SelectItem value="3">CID 3</SelectItem>
                              <SelectItem value="4">CID 4</SelectItem>
                              <SelectItem value="5">CID 5</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {isVerizon && (
                          <FieldDescription>
                            {t(
                              "custom_profiles.form.cid_locked_verizon_inline",
                            )}
                          </FieldDescription>
                        )}
                      </Field>
                    </div>
                    <FieldSeparator />
                    <Field>
                      <FieldLabel>
                        {t("custom_profiles.form.fields.imei_label")}
                      </FieldLabel>
                      <Input
                        placeholder={t(
                          "custom_profiles.form.fields.imei_label",
                        )}
                        className="font-mono"
                        value={imei}
                        onChange={(e) => setImei(e.target.value)}
                      />
                      <FieldDescription className="text-warning">
                        {t("custom_profiles.form.fields.imei_danger")}
                      </FieldDescription>
                    </Field>

                    <div className="grid grid-cols-1 gap-4 @xl/card:grid-cols-2">
                      <Field>
                        <FieldLabel>
                          {t("custom_profiles.form.fields.ttl_label")}
                        </FieldLabel>
                        <Input
                          placeholder={t(
                            "custom_profiles.form.fields.ttl_label",
                          )}
                          inputMode="numeric"
                          className="tabular-nums"
                          value={ttl}
                          onChange={(e) => setTtl(e.target.value)}
                        />
                      </Field>

                      <Field>
                        <FieldLabel>
                          {t("custom_profiles.form.fields.hl_label")}
                        </FieldLabel>
                        <Input
                          placeholder={t(
                            "custom_profiles.form.fields.hl_label",
                          )}
                          inputMode="numeric"
                          className="tabular-nums"
                          value={hl}
                          onChange={(e) => setHl(e.target.value)}
                        />
                      </Field>
                    </div>
                  </FieldGroup>
                </FieldSet>
               </WizardPanel>
              </TabsContent>
              <TabsContent value="scenario">
               <WizardPanel dir={tabDir}>
                <FieldSet>
                  <FieldDescription>
                    {t("custom_profiles.form.scenario_desc_inline")}
                  </FieldDescription>
                  <FieldGroup>
                    {/* Default scenario — the always-on choice, reads first. */}
                    <Field>
                      <FieldLabel htmlFor="default-scenario">
                        {t("custom_profiles.form.default_scenario_label")}
                      </FieldLabel>
                      <Select
                        value={defaultScenario}
                        onValueChange={handleDefaultScenarioChange}
                      >
                        <SelectTrigger id="default-scenario">
                          <SelectValue
                            placeholder={t(
                              "custom_profiles.form.default_scenario_label",
                            )}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {scenarios.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                          <SelectSeparator />
                          <SelectItem value={CREATE_SCENARIO_VALUE}>
                            <MaterialSymbol name="add" size={16} />
                            {t("custom_profiles.form.create_scenario_option")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        {t("custom_profiles.form.default_scenario_hint")}
                      </FieldDescription>
                    </Field>

                    {/* Schedule opt-in. */}
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="grid gap-0.5">
                        <Label>
                          {t("custom_profiles.form.schedule_inline_label")}
                        </Label>
                        <span className="text-muted-foreground text-xs">
                          {t("custom_profiles.form.schedule_inline_hint")}
                        </span>
                      </div>
                      <SegmentedField
                        value={scheduleEnabled ? "on" : "off"}
                        onValueChange={(v) => setScheduleEnabled(v === "on")}
                        options={[
                          { value: "off", label: t("state.off", { ns: "common" }) },
                          { value: "on", label: t("state.on", { ns: "common" }) },
                        ]}
                        ariaLabel={t("custom_profiles.form.schedule_inline_label")}
                        breakpoint="never"
                        glyph={(cls) => (
                          <MaterialSymbol name="check" size={16} className={cls} />
                        )}
                      />
                    </div>

                    {/* Windows — only when the schedule is on. */}
                    {scheduleEnabled && (
                      <div className="flex flex-col gap-3">
                        {windows.length === 0 ? (
                          <div className="text-muted-foreground rounded-card bg-surface-container p-4 text-center text-sm">
                            {t("custom_profiles.form.windows_empty")}
                          </div>
                        ) : (
                          <AnimatePresence initial={false}>
                          {windows.map((w, i) => (
                            <motion.div
                              key={w.id}
                              initial={
                                reduceMotion
                                  ? false
                                  : { opacity: 0, height: 0 }
                              }
                              animate={{ opacity: 1, height: "auto" }}
                              exit={
                                reduceMotion
                                  ? { opacity: 0 }
                                  : { opacity: 0, height: 0 }
                              }
                              transition={
                                reduceMotion ? { duration: 0 } : transitionStandard
                              }
                              className="overflow-hidden"
                            >
                            <div className="rounded-card bg-surface-container p-3">
                              <div className="mb-3 flex items-center justify-between">
                                <span className="text-sm font-medium">
                                  {t("custom_profiles.form.window_label", {
                                    index: i + 1,
                                  })}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="text-muted-foreground hover:text-foreground size-7"
                                  onClick={() => removeWindow(w.id)}
                                  aria-label={t(
                                    "custom_profiles.form.window_remove_aria",
                                    { index: i + 1 },
                                  )}
                                >
                                  <MaterialSymbol name="close" size={16} />
                                </Button>
                              </div>
                              <div className="flex flex-col gap-3">
                                <Field>
                                  <FieldLabel htmlFor={`window-scenario-${w.id}`}>
                                    {t(
                                      "custom_profiles.form.scenario.block_scenario_label",
                                    )}
                                  </FieldLabel>
                                  <Select
                                    value={w.scenario}
                                    onValueChange={(v) =>
                                      updateWindow(w.id, { scenario: v })
                                    }
                                  >
                                    <SelectTrigger
                                      id={`window-scenario-${w.id}`}
                                    >
                                      <SelectValue
                                        placeholder={t(
                                          "custom_profiles.form.scenario.block_scenario_label",
                                        )}
                                      />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectGroup>
                                        {scenarios.map((s) => (
                                          <SelectItem key={s.id} value={s.id}>
                                            {s.name}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                </Field>
                                <div className="grid grid-cols-1 gap-3 @xl/card:grid-cols-2">
                                  <Field>
                                    <FieldLabel htmlFor={`window-start-${w.id}`}>
                                      {t("custom_profiles.form.window_from")}
                                    </FieldLabel>
                                    <Input
                                      id={`window-start-${w.id}`}
                                      type="time"
                                      className="tabular-nums"
                                      value={w.start}
                                      onChange={(e) =>
                                        updateWindow(w.id, {
                                          start: e.target.value,
                                        })
                                      }
                                    />
                                  </Field>
                                  <Field>
                                    <FieldLabel htmlFor={`window-end-${w.id}`}>
                                      {t("custom_profiles.form.window_to")}
                                    </FieldLabel>
                                    <Input
                                      id={`window-end-${w.id}`}
                                      type="time"
                                      className="tabular-nums"
                                      value={w.end}
                                      onChange={(e) =>
                                        updateWindow(w.id, {
                                          end: e.target.value,
                                        })
                                      }
                                    />
                                  </Field>
                                </div>
                              </div>
                            </div>
                            </motion.div>
                          ))}
                          </AnimatePresence>
                        )}

                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {t("custom_profiles.form.windows_count", {
                              count: windows.length,
                              max: MAX_WINDOWS,
                            })}
                          </span>
                          <Button
                            type="button"
                            variant="tonal-neutral"
                            size="sm"
                            onClick={addWindow}
                            disabled={atCap}
                          >
                            <MaterialSymbol name="add" size={16} />
                            {t("custom_profiles.form.add_window")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </FieldGroup>
                </FieldSet>
               </WizardPanel>
              </TabsContent>
              <TabsContent value="review">
               <WizardPanel dir={tabDir}>
                <FieldSet>
                  <FieldDescription>
                    {isEditing
                      ? t("custom_profiles.form.review_desc_edit")
                      : t("custom_profiles.form.review_desc_add")}
                  </FieldDescription>
                  <div className="flex flex-col gap-5">
                    <SummarySection
                      title={t("custom_profiles.form.review.section_identity")}
                      onEdit={() => changeTab("identity")}
                      rows={[
                        {
                          label: t("custom_profiles.form.review.profile_name"),
                          value: name.trim() || null,
                        },
                        {
                          label: t("custom_profiles.form.review.sim_iccid"),
                          value:
                            simIccid.trim() ||
                            t("custom_profiles.form.review.all_sims"),
                          mono: simIccid.trim() !== "",
                        },
                        {
                          label: t("custom_profiles.form.review.operator"),
                          value:
                            getMnoPreset(mnoId)?.label ??
                            t("custom_profiles.form.fields.mno_custom"),
                        },
                      ]}
                    />
                    <SummarySection
                      title={t("custom_profiles.form.review.section_network")}
                      onEdit={() => changeTab("network")}
                      rows={[
                        {
                          label: t("custom_profiles.form.review.apn"),
                          value: apn.trim() || null,
                          mono: true,
                        },
                        {
                          label: t("custom_profiles.form.review.ip_protocol"),
                          value: PDP_DISPLAY[pdp] ?? pdp,
                        },
                        {
                          label: t("custom_profiles.form.review.profile_slot"),
                          value:
                            cid === "1"
                              ? t(
                                  "custom_profiles.form.review.cid_value_default",
                                  { cid },
                                )
                              : t("custom_profiles.form.review.cid_value", {
                                  cid,
                                }),
                          numeric: true,
                        },
                        {
                          label: t(
                            "custom_profiles.form.review.preferred_imei",
                          ),
                          value: imei.trim() || null,
                          mono: true,
                        },
                        {
                          label: t("custom_profiles.form.review.ttl_hl"),
                          value:
                            ttl.trim() || hl.trim()
                              ? `${ttl.trim() || "—"} / ${hl.trim() || "—"}`
                              : null,
                          numeric: true,
                        },
                      ]}
                    />
                    <SummarySection
                      title={t("custom_profiles.form.review.section_scenario")}
                      onEdit={() => changeTab("scenario")}
                      rows={[
                        {
                          label: t("custom_profiles.form.review.default"),
                          value: nameForId(defaultScenario),
                        },
                        ...(scheduleEnabled
                          ? windows.length === 0
                            ? [
                                {
                                  label: t(
                                    "custom_profiles.form.review.schedule",
                                  ),
                                  value: t(
                                    "custom_profiles.form.review.schedule_on_no_windows",
                                  ),
                                },
                              ]
                            : windows.map((w, i) => ({
                                label: t(
                                  "custom_profiles.form.window_label",
                                  { index: i + 1 },
                                ),
                                value: t(
                                  "custom_profiles.form.review.window_value",
                                  {
                                    scenario: nameForId(w.scenario),
                                    start: w.start,
                                    end: w.end,
                                  },
                                ),
                                numeric: true,
                              }))
                          : [
                              {
                                label: t(
                                  "custom_profiles.form.review.schedule",
                                ),
                                value: t(
                                  "custom_profiles.form.review.schedule_off",
                                ),
                              },
                            ]),
                      ]}
                    />
                  </div>
                </FieldSet>
               </WizardPanel>
              </TabsContent>
            </Tabs>
          </FieldGroup>
        </form>
      </CardContent>

      <CardFoot
        className="px-6"
        status={
          duplicateIccid ? (
            <span className="text-destructive inline-flex items-center gap-1.5">
              <MaterialSymbol name="error" size={16} />
              {t("custom_profiles.form.fields.sim_iccid_duplicate")}
            </span>
          ) : null
        }
        actions={
          <>
            <Button
              variant="ghost"
              size="action"
              type="button"
              onClick={onCancel}
            >
              {t("actions.cancel", { ns: "common" })}
            </Button>
            {/*
              Distinct keys are LOAD-BEARING, not cosmetic. Without them React
              reconciles these two buttons by position and reuses the same
              <button> DOM node, mutating its `type` from "button" to "submit"
              in place. Because React 18 flushes the "Next" click synchronously,
              that mutation lands BEFORE the browser performs the click's
              default action, so the browser sees a submit button and submits
              the form, silently saving the profile on every Next to Review
              step. Separate keys force a remount: the clicked node stays
              type="button" for its whole life, so no stray submit fires.
            */}
            {isReview ? (
              <SaveButton
                key="profile-submit"
                type="submit"
                form={formId}
                size="action"
                isSaving={submitting}
                saved={saved}
                label={
                  isEditing
                    ? t("custom_profiles.form.submit_edit")
                    : t("custom_profiles.form.submit_add")
                }
                blockedReason={
                  duplicateIccid
                    ? t("custom_profiles.form.fields.sim_iccid_duplicate")
                    : null
                }
              />
            ) : (
              <Button
                key="profile-next"
                type="button"
                variant="tonal-neutral"
                size="action"
                onClick={goNext}
              >
                {t("custom_profiles.form.next")}
              </Button>
            )}
          </>
        }
      />

      {/* Verizon brick-guard — selecting Verizon warns before committing. */}
      <AlertDialog open={verizonDialogOpen} onOpenChange={setVerizonDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("custom_profiles.form.verizon_inline.dialog_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("custom_profiles.form.verizon_inline.dialog_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">
              {t("custom_profiles.form.verizon_inline.dialog_cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => applyMno(pendingMnoRef.current)}>
              {t("custom_profiles.form.verizon_inline.dialog_confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

// -----------------------------------------------------------------------------
// Review-tab building blocks (presentational summary bound to live form state).
// -----------------------------------------------------------------------------
interface SummaryRow {
  label: string;
  value: string | null;
  numeric?: boolean;
  /** An opaque string you compare (ICCID, IMEI, APN): JetBrains Mono. */
  mono?: boolean;
}

const SummarySection = ({
  title,
  rows,
  onEdit,
}: {
  title: string;
  rows: SummaryRow[];
  onEdit: () => void;
}) => {
  const { t } = useTranslation("cellular");
  return (
  <section>
    <div className="mb-1 flex items-center justify-between">
      <h3 className="text-sm font-semibold">{title}</h3>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2"
        onClick={onEdit}
      >
        <MaterialSymbol name="edit" size={14} />
        {t("custom_profiles.form.review_edit_aria")}
      </Button>
    </div>
    <dl className="divide-border divide-y">
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 py-2 text-sm"
        >
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd
            className={
              row.value === null
                ? "text-muted-foreground/60"
                : row.mono
                  ? "text-right font-mono font-medium break-all"
                  : row.numeric
                    ? "text-right font-medium tabular-nums"
                    : "text-right font-medium"
            }
          >
            {row.value ?? t("custom_profiles.form.review.not_set")}
          </dd>
        </div>
      ))}
    </dl>
  </section>
  );
};

export default ProfileInputComponent;
