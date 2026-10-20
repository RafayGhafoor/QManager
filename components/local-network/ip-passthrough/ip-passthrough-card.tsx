"use client";

import * as React from "react";
import {
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LockIcon, RefreshCcwIcon } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { fieldVariants } from "@/components/ui/input";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  SegmentedField,
  type SegmentedOption,
} from "@/components/ui/segmented-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useMotionReduced } from "@/components/motion-preference";
import { ResultAlert } from "@/components/local-network/traffic-engine/result-alert";
import { useActiveProfile } from "@/hooks/use-active-profile";
import { useLanDevices } from "@/hooks/use-lan-devices";
import { DUR, EASE_STANDARD, staggerRowItem, staggerRows } from "@/lib/motion";
import { enterRebootFlow } from "@/lib/reboot";
import { cn } from "@/lib/utils";
import type {
  IpPassthroughApplyData,
  IpPassthroughSaveResult,
} from "@/hooks/use-ip-passthrough";
import type {
  DnsProxy,
  IpptNat,
  PassthroughMode,
  UsbMode,
} from "@/types/ip-passthrough";

import {
  AUTOMATIC_MAC,
  CARD_DESC,
  CARD_GRID,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  DEVICE_PICK,
  LOCK_NOTE,
  MAC_FIELD,
  SETTING,
  SKELETON,
} from "./shapes";
import { USB_SHORT } from "./status-strip";

// Applying writes every setting and the CGI reboots the modem two seconds after
// its response is flushed; the AlertDialog stays in front of it, and success is
// the /reboot/ hand-off (enterRebootFlow), so only failures toast.
// Contract: docs/features/ip-passthrough.md.

const K = "ippt";

/**
 * Where the target MAC comes from. "device" (target-only) picks from the live
 * LAN scan and writes the pick into `macInput`, so it validates and applies
 * exactly like a typed MAC.
 */
type MacSource = "automatic" | "device" | "manual";
/** Descriptive local values: Radix's Select treats a bare `"0"` as unset. */
type NatMode = "nat-on" | "nat-off";
type UsbModeLocal = "rmnet" | "ecm" | "mbim" | "rndis";

const USB_TO_API: Record<UsbModeLocal, UsbMode> = {
  rmnet: "0",
  ecm: "1",
  mbim: "2",
  rndis: "3",
};

const USB_FROM_API: Record<string, UsbModeLocal> = {
  "0": "rmnet",
  "1": "ecm",
  "2": "mbim",
  "3": "rndis",
};

const USB_ORDER: readonly UsbModeLocal[] = ["rmnet", "ecm", "mbim", "rndis"];

const MAC_PATTERN = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

/** The fill marks the pick; no check glyph on this surface. */
const NO_GLYPH = () => null;

interface Draft {
  mode: PassthroughMode;
  macSource: MacSource;
  macInput: string;
  nat: NatMode;
  usb: UsbModeLocal;
  dns: DnsProxy;
}

/** The MAC actually sent; both the dirty check and the apply go through it. */
function resolveMac(d: Draft): string {
  if (d.mode === "disabled") return "";
  return d.macSource === "automatic" ? AUTOMATIC_MAC : d.macInput;
}

function SettingRow({
  label,
  sub,
  held = false,
  wide = false,
  children,
}: {
  label: string;
  sub?: string;
  held?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div variants={staggerRowItem} className={SETTING.ROW}>
      <div className={cn(SETTING.KEY, held && SETTING.HELD)}>
        <span className={SETTING.KEY_LINE}>
          {label}
        </span>
        {sub ? <span className={SETTING.KEY_SUB}>{sub}</span> : null}
      </div>
      <div className={wide ? SETTING.CONTROL_WIDE : SETTING.CONTROL}>
        {children}
      </div>
    </motion.div>
  );
}

/** Mirrors one card's rows. */
function SettingsSkeleton({ pills }: { pills: string[] }) {
  return (
    <div className={SETTING.GROUP} aria-hidden>
      {pills.map((pill, i) => (
        <div key={i} className={SETTING.ROW}>
          <Skeleton className={SKELETON.ROW_KEY} />
          <Skeleton className={cn(SKELETON.PILL, "ml-auto", pill)} />
        </div>
      ))}
    </div>
  );
}

/** The live connected-device list behind "Connected device". */
function DevicePicker({
  value,
  onPick,
  onManual,
  disabled,
}: {
  value: string;
  onPick: (mac: string) => void;
  onManual: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("local-network");
  // Mounted only while "Connected device" is picked, so the LAN is scanned on demand.
  const { devices, isLoading, error, refresh } = useLanDevices(true);
  const selected = devices.find((d) => d.mac.toUpperCase() === value);

  if (isLoading) {
    return (
      <div className={DEVICE_PICK.WRAP}>
        <p role="status" className={DEVICE_PICK.NOTE}>
          <RefreshCcwIcon
            className={cn(DEVICE_PICK.GLYPH, "motion-safe:animate-spin")}
            aria-hidden
          />
          {t(`${K}.device.scanning`)}
        </p>
      </div>
    );
  }

  if (error !== null || devices.length === 0) {
    return (
      <div className={DEVICE_PICK.WRAP}>
        <p
          role={error !== null ? "alert" : "status"}
          className={cn(DEVICE_PICK.NOTE, error !== null && DEVICE_PICK.NOTE_ERROR)}
        >
          {error !== null ? t(`${K}.device.error`) : t(`${K}.device.empty`)}
        </p>
        <div className={DEVICE_PICK.LINKS}>
          <button
            type="button"
            onClick={refresh}
            disabled={disabled}
            className={DEVICE_PICK.LINK}
          >
            <RefreshCcwIcon className={DEVICE_PICK.GLYPH} aria-hidden />
            {error !== null ? t(`${K}.device.retry`) : t(`${K}.device.rescan`)}
          </button>
          <button
            type="button"
            onClick={onManual}
            disabled={disabled}
            className={DEVICE_PICK.LINK}
          >
            {t(`${K}.device.enter_manually`)}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={DEVICE_PICK.WRAP}>
      <div className={DEVICE_PICK.LINE}>
        <Select
          value={selected?.mac ?? ""}
          onValueChange={(v) => onPick(v.toUpperCase())}
          disabled={disabled}
        >
          <SelectTrigger
            aria-label={t(`${K}.device.label`)}
            className={DEVICE_PICK.TRIGGER}
          >
            <SelectValue placeholder={t(`${K}.device.placeholder`)} />
          </SelectTrigger>
          <SelectContent>
            {devices.map((d) => (
              <SelectItem key={d.mac} value={d.mac}>
                <span className={DEVICE_PICK.ITEM}>
                  <span className={DEVICE_PICK.ITEM_NAME}>
                    {d.hostname || d.ip || t(`${K}.device.unknown`)}
                  </span>
                  <span className={DEVICE_PICK.ITEM_MAC}>{d.mac.toUpperCase()}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="tonal-neutral"
          size="icon"
          onClick={refresh}
          disabled={disabled}
          aria-label={t(`${K}.device.rescan_label`)}
          className={DEVICE_PICK.RESCAN}
        >
          <RefreshCcwIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export interface IpPassthroughCardProps {
  /** `null` until the first successful read. */
  passthroughMode: PassthroughMode | null;
  targetMac: string | null;
  ipptNat: IpptNat | null;
  usbMode: UsbMode | null;
  dnsProxy: DnsProxy | null;
  isLoading: boolean;
  isSaving: boolean;
  /** True when a read failed and left nothing behind. */
  failed: boolean;
  saveSettings: (data: IpPassthroughApplyData) => Promise<IpPassthroughSaveResult>;
}

export function IPPassthroughCard({
  passthroughMode,
  targetMac,
  ipptNat,
  usbMode,
  dnsProxy,
  isLoading,
  isSaving,
  failed,
  saveSettings,
}: IpPassthroughCardProps) {
  const { t } = useTranslation("local-network");
  const { saved, markSaved } = useSaveFlash();
  const reduced = useMotionReduced();
  const formId = useId();
  const {
    activeProfile,
    isVerizonActive,
    isLoading: isProfileLoading,
  } = useActiveProfile();
  const locked = !isProfileLoading && isVerizonActive;

  // Edits laid over the saved baseline: a re-read re-bases them instead of erasing them.
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const [showConfirm, setShowConfirm] = useState(false);

  const baseline = useMemo<Draft | null>(() => {
    if (
      passthroughMode === null ||
      ipptNat === null ||
      usbMode === null ||
      dnsProxy === null
    ) {
      return null;
    }
    const mac = (targetMac ?? "").toUpperCase();
    const automatic = mac === "" || mac === AUTOMATIC_MAC;
    return {
      mode: passthroughMode,
      macSource: automatic ? "automatic" : "manual",
      macInput: automatic ? "" : mac,
      nat: ipptNat === "1" ? "nat-on" : "nat-off",
      usb: USB_FROM_API[usbMode] ?? "ecm",
      dns: dnsProxy,
    };
  }, [passthroughMode, targetMac, ipptNat, usbMode, dnsProxy]);

  const draft = useMemo<Draft | null>(
    () => (baseline === null ? null : { ...baseline, ...edits }),
    [baseline, edits],
  );

  const state = draft !== null && baseline !== null ? { draft, baseline } : null;

  const setField = <F extends keyof Draft>(field: F, value: Draft[F]) => {
    setEdits((prev) => ({ ...prev, [field]: value }));
  };

  const modeDirty = state !== null && state.draft.mode !== state.baseline.mode;
  const targetDirty =
    state !== null && resolveMac(state.draft) !== resolveMac(state.baseline);
  const natDirty = state !== null && state.draft.nat !== state.baseline.nat;
  const usbDirty = state !== null && state.draft.usb !== state.baseline.usb;
  const dnsDirty = state !== null && state.draft.dns !== state.baseline.dns;

  const dirtyCount = [
    modeDirty,
    targetDirty,
    natDirty,
    usbDirty,
    dnsDirty,
  ].filter(Boolean).length;

  const macRequired = state !== null && state.draft.mode !== "disabled";
  const macSource = state?.draft.macSource ?? "automatic";
  const macManual = macRequired && macSource === "manual";
  const macPicking = macRequired && macSource === "device";
  // A device pick and a typed MAC both land in `macInput`; both must be whole.
  const macValid =
    state === null ||
    !macRequired ||
    macSource === "automatic" ||
    MAC_PATTERN.test(state.draft.macInput);

  const blockedReason =
    state === null
      ? t(`${K}.errors.card_unread`)
      : locked
        ? t(`${K}.locked_by_verizon.blocked`)
        : !macValid
          ? macPicking
            ? t(`${K}.errors.device_unpicked`)
            : t(`${K}.errors.mac_invalid`)
          : dirtyCount === 0
            ? t(`${K}.errors.no_changes`)
            : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (blockedReason !== null) return;
    setShowConfirm(true);
  };

  const handleDiscard = () => {
    setEdits({});
  };

  const handleConfirmedApply = async () => {
    setShowConfirm(false);
    if (draft === null) return;

    const result = await saveSettings({
      passthrough_mode: draft.mode,
      target_mac: resolveMac(draft),
      ippt_nat: draft.nat === "nat-on" ? "1" : "0",
      usb_mode: USB_TO_API[draft.usb],
      dns_proxy: draft.dns,
    });

    if (!result.success) {
      toast.error(result.error ?? t(`${K}.toast_apply_error`));
      return;
    }

    // Success is the hand-off itself: mark in flight, sign out, /reboot/ countdown.
    markSaved();
    enterRebootFlow("ip_passthrough");
  };

  // Strip non-hex, uppercase, re-insert colons: typing is format-correct by construction.
  const handleMacChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
    const formatted = raw.match(/.{1,2}/g)?.join(":") ?? raw;
    setField("macInput", formatted.slice(0, 17));
  };

  const held = isSaving || state === null || locked;

  const modeOptions: readonly SegmentedOption<PassthroughMode>[] = [
    { value: "disabled", label: t(`${K}.options.mode_disabled`) },
    { value: "eth", label: t(`${K}.options.mode_eth`) },
    { value: "usb", label: t(`${K}.options.mode_usb`) },
  ];
  const targetOptions: readonly SegmentedOption<MacSource>[] = [
    { value: "automatic", label: t(`${K}.options.target_automatic`) },
    { value: "device", label: t(`${K}.options.target_device`) },
    { value: "manual", label: t(`${K}.options.target_manual`) },
  ];
  const natOptions: readonly SegmentedOption<NatMode>[] = [
    { value: "nat-on", label: t(`${K}.options.nat_on`) },
    { value: "nat-off", label: t(`${K}.options.nat_off`) },
  ];
  const usbOptions: readonly SegmentedOption<UsbModeLocal>[] = USB_ORDER.map(
    (v) => ({ value: v, label: USB_SHORT[USB_TO_API[v]] }),
  );
  const dnsOptions: readonly SegmentedOption<DnsProxy>[] = [
    { value: "disabled", label: t(`${K}.options.dns_off`) },
    { value: "enabled", label: t(`${K}.options.dns_on`) },
  ];

  // The MAC slot mounts after the cards' cascade, so it declares its own entrance:
  // the row rise and no exit (a swapped-out control is simply gone).
  const revealMotion = {
    initial: { opacity: 0, y: reduced ? 0 : 5 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: DUR.quick, ease: EASE_STANDARD },
  } as const;

  // Rows land behind a skeleton, after the page cascade has run, so each card's
  // row group starts its own row cascade on mount.
  const rowCascade = {
    variants: staggerRows,
    initial: "hidden",
    animate: "visible",
  } as const;

  const pending = state === null && (isLoading || !failed);
  const unread = (
    <p className={SETTING.UNREAD}>{t(`${K}.errors.card_unread`)}</p>
  );

  return (
    <>
      <div className={CARD_GRID}>
        {/* Passthrough owns the one apply: Mode is what reboots into a new topology. */}
        <Card className={CARD_SHELL}>
          <CardHeader className={CARD_PAD}>
            <CardTitle className={CARD_TITLE}>
              {t(`${K}.groups.passthrough`)}
            </CardTitle>
            <CardDescription className={CARD_DESC}>
              {t(`${K}.card.description`)}
            </CardDescription>
          </CardHeader>

          <CardContent className={cn(CARD_PAD, "flex flex-col gap-5")}>
            {locked ? (
              <div role="status" className={LOCK_NOTE.ROOT}>
                <span aria-hidden className={LOCK_NOTE.DISC}>
                  <LockIcon className={LOCK_NOTE.GLYPH} />
                </span>
                <div className={LOCK_NOTE.TEXT}>
                  <p className={LOCK_NOTE.TITLE}>
                    {t(`${K}.locked_by_verizon.title`)}
                  </p>
                  <p className={LOCK_NOTE.BODY}>
                    {t(`${K}.locked_by_verizon.body`, {
                      name: activeProfile?.name ?? "",
                    })}
                  </p>
                </div>
                <Link href="/cellular/custom-profiles" className={LOCK_NOTE.ACTION}>
                  {t(`${K}.locked_by_verizon.cta`)}
                </Link>
              </div>
            ) : null}

            {state === null ? (
              pending ? (
                <SettingsSkeleton pills={["w-60", "w-72"]} />
              ) : (
                unread
              )
            ) : (
              <motion.form
                id={formId}
                className={SETTING.GROUP}
                onSubmit={handleSubmit}
                {...rowCascade}
              >
                <SettingRow
                  label={t(`${K}.rows.mode.label`)}
                  sub={t(`${K}.rows.mode.description`)}
                >
                  <SegmentedField
                    value={state.draft.mode}
                    onValueChange={(v) => setField("mode", v)}
                    options={modeOptions}
                    ariaLabel={t(`${K}.rows.mode.label`)}
                    disabled={held}
                    breakpoint="never"
                    glyph={NO_GLYPH}
                  />
                </SettingRow>

                {/* Router keeps the modem as the gateway, so the warning only applies to Ethernet / USB. */}
                {state.draft.mode !== "disabled" ? (
                  <ResultAlert tone="warning" className="py-3 text-sm leading-normal">
                    {modeDirty
                      ? t(`${K}.mode_note.to_passthrough`)
                      : t(`${K}.mode_note.rest`)}
                  </ResultAlert>
                ) : null}

                <SettingRow
                  label={t(`${K}.rows.target.label`)}
                  sub={
                    macRequired
                      ? t(`${K}.rows.target.description`)
                      : t(`${K}.rows.target.pick_mode`)
                  }
                  held={!macRequired}
                  wide
                >
                  <SegmentedField
                    value={state.draft.macSource}
                    onValueChange={(v) => setField("macSource", v)}
                    options={targetOptions}
                    ariaLabel={t(`${K}.rows.target.label`)}
                    disabled={held || !macRequired}
                    breakpoint="lg"
                    glyph={NO_GLYPH}
                  />
                  {macPicking ? (
                    <motion.div
                      key="mac-device"
                      className={DEVICE_PICK.SLOT}
                      {...revealMotion}
                    >
                      <DevicePicker
                        value={state.draft.macInput}
                        onPick={(mac) => setField("macInput", mac)}
                        onManual={() => setField("macSource", "manual")}
                        disabled={held}
                      />
                    </motion.div>
                  ) : macManual ? (
                    <motion.div
                      key="mac-entry"
                      className={MAC_FIELD.WRAP}
                      {...revealMotion}
                    >
                      <input
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={17}
                        value={state.draft.macInput}
                        onChange={handleMacChange}
                        disabled={held}
                        aria-label={t(`${K}.card.mac_label`)}
                        aria-invalid={!macValid || undefined}
                        placeholder={t(`${K}.card.mac_placeholder`)}
                        className={cn(fieldVariants(), MAC_FIELD.INPUT)}
                      />
                      {!macValid ? (
                        <span className={MAC_FIELD.ERROR} role="alert">
                          {t(`${K}.errors.mac_invalid`)}
                        </span>
                      ) : null}
                    </motion.div>
                  ) : null}
                </SettingRow>
              </motion.form>
            )}
          </CardContent>

          {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps Enter-to-submit. */}
          <CardFoot
            className={CARD_PAD}
            actions={
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleDiscard}
                  disabled={isSaving || dirtyCount === 0}
                  size="action"
                >
                  {t("common:actions.discard")}
                </Button>
                <SaveButton
                  type="submit"
                  form={formId}
                  variant={modeDirty ? "destructive" : "default"}
                  isSaving={isSaving}
                  saved={saved}
                  label={t(`${K}.card.apply`)}
                  blockedReason={blockedReason}
                  size="action"
                />
              </>
            }
          />
        </Card>

        {/* Network shares the draft and the reboot, so it has no footer of its own:
            the Passthrough footer counts and applies both. */}
        <Card className={CARD_SHELL}>
          <CardHeader className={CARD_PAD}>
            <CardTitle className={CARD_TITLE}>{t(`${K}.groups.network`)}</CardTitle>
            <CardDescription className={CARD_DESC}>
              {t(`${K}.card.network_description`)}
            </CardDescription>
          </CardHeader>

          <CardContent className={CARD_PAD}>
            {state === null ? (
              pending ? (
                <SettingsSkeleton pills={["w-52", "w-72", "w-28"]} />
              ) : (
                unread
              )
            ) : (
              <motion.div className={SETTING.GROUP} {...rowCascade}>
                <SettingRow
                  label={t(`${K}.rows.nat.label`)}
                  sub={t(`${K}.rows.nat.description`)}
                >
                  <SegmentedField
                    value={state.draft.nat}
                    onValueChange={(v) => setField("nat", v)}
                    options={natOptions}
                    ariaLabel={t(`${K}.rows.nat.label`)}
                    disabled={held}
                    breakpoint="never"
                    glyph={NO_GLYPH}
                  />
                </SettingRow>

                <SettingRow
                  label={t(`${K}.rows.usb.label`)}
                  sub={t(`${K}.rows.usb.description`)}
                  wide
                >
                  <SegmentedField
                    value={state.draft.usb}
                    onValueChange={(v) => setField("usb", v)}
                    options={usbOptions}
                    ariaLabel={t(`${K}.rows.usb.label`)}
                    disabled={held}
                    breakpoint="lg"
                    glyph={NO_GLYPH}
                  />
                </SettingRow>

                <SettingRow
                  label={t(`${K}.rows.dns.label`)}
                  sub={t(`${K}.rows.dns.description`)}
                >
                  <SegmentedField
                    value={state.draft.dns}
                    onValueChange={(v) => setField("dns", v)}
                    options={dnsOptions}
                    ariaLabel={t(`${K}.rows.dns.label`)}
                    disabled={held}
                    breakpoint="never"
                    glyph={NO_GLYPH}
                  />
                </SettingRow>
              </motion.div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.dialog.title`)}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3 text-sm">
                <p>{t(`${K}.dialog.body`)}</p>
                {state !== null && state.draft.mode !== "disabled" ? (
                  <p className="text-on-surface font-medium">
                    {t(`${K}.dialog.body_gateway`)}
                  </p>
                ) : null}
                <p>{t(`${K}.dialog.body_persist`)}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(`${K}.dialog.cancel`)}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmedApply}>
              {t(`${K}.dialog.confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default IPPassthroughCard;
