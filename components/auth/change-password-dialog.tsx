"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { changePassword } from "@/hooks/use-auth";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { PasswordRequirements, isPasswordValid } from "@/components/auth/password-requirements";
import { StrongPasswordToggle } from "@/components/auth/strong-password-toggle";
import { cn } from "@/lib/utils";

// =============================================================================
// ChangePasswordDialog — the account menu's password change
// =============================================================================
// Reference: the fork's dialog (a05c4e92), plus the target-only strength rule
// (`StrongPasswordToggle`, `PasswordRequirements`). The dialog surface
// (`card-sheen`, the Modal-Exit clocks) comes from `components/ui/dialog.tsx`.
//
// Confirmation follows the navigation exception of the Toast-Confirms Rule:
// on success `changePassword()` clears the session and moves to `/login/`,
// which is the success signal. A server failure toasts the reason resolved
// from the returned result. Client-side validation stays inline, under the
// fields, because nothing was sent.

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PasswordInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  disabled: boolean;
  describedBy?: string;
}

function PasswordInput({ id, value, onChange, autoComplete, disabled, describedBy }: PasswordInputProps) {
  const { t } = useTranslation("common");
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        disabled={disabled}
        className="pr-10"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        aria-label={visible ? t("login.hide_password") : t("login.show_password")}
      >
        {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </Button>
    </div>
  );
}

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: ChangePasswordDialogProps) {
  const { t } = useTranslation("common");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [useStrongPassword, setUseStrongPassword] = useState(true);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Remounts the inputs on close so each one's show/hide state resets too.
  const [formKey, setFormKey] = useState(0);

  const reset = useCallback(() => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setUseStrongPassword(true);
    setError("");
    setIsSubmitting(false);
    setFormKey((k) => k + 1);
  }, []);

  const handleOpenChange = useCallback(
    (value: boolean) => {
      if (!value) reset();
      onOpenChange(value);
    },
    [onOpenChange, reset]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");

      // Single source of truth for rules: components/auth/password-requirements.tsx.
      // Server-side copy lives in scripts/www/cgi-bin/quecmanager/auth/password.sh.
      if (!isPasswordValid(newPassword, useStrongPassword)) {
        setError(
          useStrongPassword
            ? t("change_password.error_weak_strong")
            : t("change_password.error_weak")
        );
        return;
      }

      if (newPassword !== confirmPassword) {
        setError(t("change_password.error_mismatch"));
        return;
      }

      setIsSubmitting(true);
      try {
        const result = await changePassword(currentPassword, newPassword, useStrongPassword);
        if (!result.success) {
          toast.error(
            resolveErrorMessage(t, result.error, result.detail, t("change_password.failed_toast"))
          );
        }
        // On success, changePassword() clears the session and redirects to login
      } finally {
        setIsSubmitting(false);
      }
    },
    [currentPassword, newPassword, confirmPassword, useStrongPassword, t]
  );

  const confirmTouched = confirmPassword.length > 0;
  const confirmMatches = newPassword === confirmPassword;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form key={formKey} onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("change_password.title")}</DialogTitle>
            <DialogDescription>{t("change_password.description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <Field>
              <FieldLabel htmlFor="current-password">
                {t("change_password.current_label")}
              </FieldLabel>
              <PasswordInput
                id="current-password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={setCurrentPassword}
                disabled={isSubmitting}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-password">{t("change_password.new_label")}</FieldLabel>
              <PasswordInput
                id="new-password"
                autoComplete="new-password"
                describedBy="change-password-reqs"
                value={newPassword}
                onChange={setNewPassword}
                disabled={isSubmitting}
              />
              <PasswordRequirements password={newPassword} enforceStrong={useStrongPassword} id="change-password-reqs" className="pt-1" />
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-new-password">
                {t("change_password.confirm_label")}
              </FieldLabel>
              <PasswordInput
                id="confirm-new-password"
                autoComplete="new-password"
                describedBy={confirmTouched ? "confirm-password-hint" : undefined}
                value={confirmPassword}
                onChange={setConfirmPassword}
                disabled={isSubmitting}
              />
              {confirmTouched && (
                <p
                  id="confirm-password-hint"
                  className={cn(
                    "text-xs transition-colors duration-[var(--duration-quick)] ease-[var(--ease-standard)]",
                    confirmMatches ? "text-success" : "text-destructive"
                  )}
                >
                  {confirmMatches ? t("change_password.match") : t("change_password.mismatch")}
                </p>
              )}
            </Field>

            <StrongPasswordToggle
              id="change-strong-password"
              checked={useStrongPassword}
              onCheckedChange={setUseStrongPassword}
              disabled={isSubmitting}
            />
            {error && <FieldError>{error}</FieldError>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("change_password.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Spinner />
                  {t("change_password.submitting")}
                </>
              ) : (
                t("change_password.submit")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
