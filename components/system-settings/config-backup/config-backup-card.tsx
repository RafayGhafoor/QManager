"use client";

import { useId, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { CardFoot } from "@/components/ui/card-foot";
import { cn } from "@/lib/utils";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import {
  BACKUP_SECTIONS,
  computeDisabledKeys,
  initialSelection,
  selectedKeys,
} from "@/lib/config-backup/sections";
import { useConfigBackup } from "@/hooks/use-config-backup";
import type {
  BackupSectionGroup,
  BackupSectionMeta,
} from "@/types/config-backup";

import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  COARSE_TARGET,
  FIELD,
  MATCH,
  PICK,
  PILL_GLYPH,
  ROW,
  ROW_GROUP,
  STACK_ROW,
} from "../shapes";

const K = "config_backup.create";
const MIN_PASSPHRASE_LEN = 10;
const GROUPS: BackupSectionGroup[] = ["connection", "monitoring"];

// These rows never flip, so the field always fills the row.
const FIELD_GROUP = cn(FIELD, "@2xl/card:w-full");
const FIELD_TOGGLE = `text-on-surface-variant hover:text-on-surface ${COARSE_TARGET}`;

interface PassphraseRowProps {
  id: string;
  label: string;
  consequence?: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  describedBy?: string;
  children?: React.ReactNode;
}

function PassphraseRow({
  id,
  label,
  consequence,
  value,
  onChange,
  disabled,
  describedBy,
  children,
}: PassphraseRowProps) {
  const { t } = useTranslation("system-settings");
  const [visible, setVisible] = useState(false);
  const Glyph = visible ? EyeOffIcon : EyeIcon;

  return (
    <div className={STACK_ROW}>
      <div className={ROW.TEXT}>
        <label htmlFor={id} className={ROW.LABEL}>
          {label}
        </label>
        {consequence ? (
          <span className={ROW.CONSEQUENCE}>{consequence}</span>
        ) : null}
      </div>
      <div className="relative w-full">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          host="container"
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-describedby={describedBy}
          className={cn(FIELD_GROUP, "pr-11")}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(FIELD_TOGGLE, "absolute top-1/2 right-1.5 -translate-y-1/2")}
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={t(visible ? `${K}.passphrase_hide_aria` : `${K}.passphrase_show_aria`)}
        >
          <Glyph className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {children}
    </div>
  );
}

const ConfigBackupCard = () => {
  const { t } = useTranslation("system-settings");
  const confirmHintId = useId();
  const [selection, setSelection] = useState(initialSelection());
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  // Bumped after a download to remount the passphrase rows, which re-hides
  // any field the user had revealed.
  const [formKey, setFormKey] = useState(0);
  const { runBackup, stage, reset } = useConfigBackup();

  const disabled = useMemo(() => computeDisabledKeys(selection), [selection]);
  const chosen = useMemo(() => selectedKeys(selection), [selection]);
  // A row the overlap rule disabled is effectively unchecked (sections.ts).
  const effective = chosen.filter((k) => !disabled.has(k));

  const busy =
    stage === "collecting" || stage === "encrypting" || stage === "downloading";
  const tooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE_LEN;
  const matches = passphrase === confirm;
  const passphraseOk = passphrase.length >= MIN_PASSPHRASE_LEN && matches;
  const canDownload = effective.length > 0 && passphraseOk && !busy;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canDownload) return;
    reset();
    const result = await runBackup(effective, passphrase);
    if (result.ok) {
      toast.success(t(`${K}.toast_success`));
      setPassphrase("");
      setConfirm("");
      setFormKey((k) => k + 1);
    } else {
      // The returned reason is "code: detail"; an unknown code falls back.
      const code = (result.error ?? "").split(":")[0].trim();
      toast.error(
        resolveErrorMessage(
          t,
          /^[a-z_]+$/.test(code) ? code : null,
          null,
          t(`${K}.toast_failed`),
        ),
      );
    }
    reset();
  };

  const status = busy ? (
    <span className="inline-flex items-center gap-2">
      <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
      {t(`${K}.stage_${stage}`)}
    </span>
  ) : (
    <span className="tabular-nums">
      {t(`${K}.selected_count`, { count: effective.length })}
    </span>
  );

  const renderRow = (s: BackupSectionMeta) => {
    const isDisabled = disabled.has(s.key);
    const checked = selection[s.key] && !isDisabled;
    const id = `backup-section-${s.key}`;
    const why = !isDisabled
      ? null
      : s.overlapGroup === "profile"
        ? t(`${K}.profile_overlap_hint`)
        : s.key === "profiles"
          ? t(`${K}.profile_uncheck_hint`)
          : null;
    return (
      <label key={s.key} htmlFor={id} className={PICK.ROW}>
        <Checkbox
          id={id}
          checked={checked}
          disabled={isDisabled || busy}
          onCheckedChange={(v) =>
            setSelection((prev) => ({ ...prev, [s.key]: v === true }))
          }
        />
        <span className={PICK.TEXT}>
          <span className={cn(PICK.NAME, isDisabled && "text-on-surface-variant")}>
            {t(`config_backup.sections.${s.key}`)}
          </span>
          {why ? <span className={PICK.WHY}>{why}</span> : null}
        </span>
      </label>
    );
  };

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card_title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.card_description`)}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <form onSubmit={handleSubmit} className={cn(CARD_BODY, "gap-5")}>
          {GROUPS.map((group) => (
            <fieldset key={group} className="flex flex-col gap-2">
              <legend className={cn(PICK.LABEL, "mb-2")}>
                {t(`${K}.group_${group}`)}
              </legend>
              <div className={ROW_GROUP}>
                {BACKUP_SECTIONS.filter((s) => s.group === group).map(renderRow)}
              </div>
            </fieldset>
          ))}

          <fieldset className="flex flex-col gap-2">
            <legend className={cn(PICK.LABEL, "mb-2")}>
              {t(`${K}.group_encryption`)}
            </legend>
            <div key={formKey} className={ROW_GROUP}>
              <PassphraseRow
                id="backup-passphrase"
                label={t(`${K}.passphrase_label`)}
                consequence={t(
                  tooShort ? `${K}.passphrase_too_short` : `${K}.warning`,
                  { min: MIN_PASSPHRASE_LEN },
                )}
                value={passphrase}
                onChange={setPassphrase}
                disabled={busy}
              />
              <PassphraseRow
                id="backup-passphrase-confirm"
                label={t(`${K}.confirm_label`)}
                value={confirm}
                onChange={setConfirm}
                disabled={busy}
                describedBy={confirm.length > 0 ? confirmHintId : undefined}
              >
                {confirm.length > 0 ? (
                  <p
                    id={confirmHintId}
                    className={cn(MATCH.ROOT, matches ? MATCH.OK : MATCH.BAD)}
                  >
                    {matches ? (
                      <CheckIcon className={MATCH.GLYPH} aria-hidden="true" />
                    ) : (
                      <XIcon className={MATCH.GLYPH} aria-hidden="true" />
                    )}
                    {t(matches ? `${K}.confirm_match` : `${K}.confirm_mismatch`)}
                  </p>
                ) : null}
              </PassphraseRow>
            </div>
          </fieldset>

          <CardFoot
            className="mt-auto"
            status={status}
            actions={
              <Button type="submit" size="action" disabled={!canDownload}>
                <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
                {t(`${K}.button_default`)}
              </Button>
            }
          />
        </form>
      </CardContent>
    </Card>
  );
};

export default ConfigBackupCard;
