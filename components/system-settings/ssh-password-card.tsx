"use client";

import { useCallback, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { toast } from "sonner";
import { CheckIcon, CircleAlertIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSshPassword } from "@/hooks/use-ssh-password";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardFoot } from "@/components/ui/card-foot";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import { cn } from "@/lib/utils";

import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  COARSE_TARGET,
  FIELD,
  GROUP_FILL,
  NOTICE,
  PASSWORD_GRID,
  ROW,
  ROW_GROUP,
} from "./shapes";

const K = "ssh";

/** The lucide check that `SegmentedField` reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

/**
 * The device's policy, mirrored so the form can say no before the round trip:
 * at least five characters, and with the strong policy on, an upper-case
 * letter, a lower-case letter and a digit.
 */
const MIN_LENGTH = 5;

function policyError(
  password: string,
  strong: boolean,
): "too_short" | "weak" | null {
  if (password.length < MIN_LENGTH) return "too_short";
  if (!strong) return null;
  return /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password)
    ? null
    : "weak";
}

// The row, restated WITHOUT `ROW.ROOT`'s side-by-side flip: these controls are
// full-width password fields, so label and field stack at every width.
const STACK_ROW = "flex flex-col gap-2.5 rounded-field px-4 py-4";

// `@2xl/card:w-full` cancels `FIELD`'s side-by-side auto-width: these rows
// never flip, so the field always fills the row.
const FIELD_GROUP = cn(FIELD, "@2xl/card:w-full");

// The toggle rides INSIDE the field via `InputGroupAddon`, so it paints 32px
// and cannot grow. `COARSE_TARGET` reaches the 44px floor with a
// pseudo-element instead of resizing the visible button.
const FIELD_TOGGLE = `text-on-surface-variant hover:text-on-surface ${COARSE_TARGET}`;

interface PasswordFieldProps {
  id: string;
  label: string;
  /** Omitted on the confirm row, which restates rather than decides. */
  consequence?: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  autoComplete: string;
}

/**
 * One password row. It owns its own show/hide state, which is the whole point
 * of the extraction — three near-identical blocks and three `showX` flags
 * collapse into one component the card never has to think about.
 */
function PasswordField({
  id,
  label,
  consequence,
  value,
  onChange,
  disabled,
  autoComplete,
}: PasswordFieldProps) {
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

      {/* `mt-auto` bottom-aligns the field, so on a wide card the three
          fields share one edge even when one consequence wraps further. */}
      <div className="relative mt-auto w-full">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          host="container"
          autoComplete={autoComplete}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onChange(e.target.value)
          }
          required
          disabled={disabled}
          className={cn(FIELD_GROUP, "pr-11")}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            FIELD_TOGGLE,
            "absolute top-1/2 right-1.5 -translate-y-1/2",
          )}
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={t(visible ? `${K}.toggle.hide` : `${K}.toggle.show`)}
        >
          <Glyph className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export default function SSHPasswordCard() {
  const { t } = useTranslation("system-settings");
  const { saved, markSaved } = useSaveFlash();
  const { changePassword, isPending } = useSshPassword();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [enforceStrong, setEnforceStrong] = useState(true);
  const [error, setError] = useState("");
  // Bumped on a successful change to remount the group, which re-hides any
  // field the user had revealed.
  const [formKey, setFormKey] = useState(0);

  const reset = useCallback(() => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setFormKey((k) => k + 1);
  }, []);

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    !isPending;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError("");

      const problem = policyError(newPassword, enforceStrong);
      if (problem) {
        setError(t(`${K}.errors.${problem}`));
        return;
      }

      if (newPassword !== confirmPassword) {
        setError(t(`${K}.errors.mismatch`));
        return;
      }

      const result = await changePassword(
        currentPassword,
        newPassword,
        enforceStrong,
      );
      if (result.success) {
        toast.success(t(`${K}.toast_saved`));
        markSaved();
        reset();
      } else {
        toast.error(result.message ?? t(`${K}.errors.failed`));
      }
    },
    [
      currentPassword,
      newPassword,
      confirmPassword,
      enforceStrong,
      changePassword,
      reset,
      markSaved,
      t,
    ],
  );

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.card.description`)}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <form
          onSubmit={handleSubmit}
          className={cn(CARD_BODY, "gap-4")}
        >
          {/* The row group is this card's slack absorber: the page grid locks
              every cell to `h-full`, and the group is what grows to fill it. */}
          <div key={formKey} className={cn(ROW_GROUP, GROUP_FILL)}>
            {/* Stacked on a phone and in the half-width desktop cell; one row
                only if the card spans the page. */}
            <div className={PASSWORD_GRID}>
              <PasswordField
                id="ssh-current-password"
                label={t(`${K}.fields.current.label`)}
                consequence={t(`${K}.fields.current.consequence`)}
                value={currentPassword}
                onChange={setCurrentPassword}
                disabled={isPending}
                autoComplete="current-password"
              />
              <PasswordField
                id="ssh-new-password"
                label={t(`${K}.fields.new.label`)}
                consequence={t(
                  enforceStrong
                    ? `${K}.fields.new.consequence_strong`
                    : `${K}.fields.new.consequence_weak`,
                )}
                value={newPassword}
                onChange={setNewPassword}
                disabled={isPending}
                autoComplete="new-password"
              />
              <PasswordField
                id="ssh-confirm-password"
                label={t(`${K}.fields.confirm.label`)}
                value={confirmPassword}
                onChange={setConfirmPassword}
                disabled={isPending}
                autoComplete="new-password"
              />
            </div>
            <div className={cn(ROW.ROOT, "min-h-0")}>
              <div className={ROW.TEXT}>
                <span className={ROW.LABEL}>
                  {t(`${K}.fields.strong.label`)}
                </span>
                <span className={ROW.CONSEQUENCE}>
                  {t(`${K}.fields.strong.consequence`)}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <SegmentedField
                  value={enforceStrong ? "on" : "off"}
                  onValueChange={(next) => setEnforceStrong(next === "on")}
                  options={[
                    { value: "off", label: t("state.off", { ns: "common" }) },
                    { value: "on", label: t("state.on", { ns: "common" }) },
                  ]}
                  ariaLabel={t(`${K}.fields.strong.label`)}
                  disabled={isPending}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                />
              </div>
            </div>
          </div>

          {error ? (
            <div role="alert" className={cn(NOTICE.BOX, NOTICE.FAILED)}>
              <CircleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
              <span className={NOTICE.TEXT}>{error}</span>
            </div>
          ) : null}

          {/* The form is the flex column, so `mt-auto` reaches the card's
              bottom edge and the submit stays inside the form. */}
          <CardFoot
            actions={
              <SaveButton
                type="submit"
                isSaving={isPending}
                saved={saved}
                label={t(`${K}.card.save`)}
                disabled={!canSubmit}
                size="action"
              />
            }
          />
        </form>
      </CardContent>
    </Card>
  );
}
