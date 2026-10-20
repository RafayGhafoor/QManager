"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  SshPasswordChangeRequest,
  SshPasswordChangeResponse,
  SshPasswordVerifyRequest,
} from "@/types/ssh-password";
import type {
  PasswordActionResult,
  PasswordActions,
} from "@/types/password-change";

// =============================================================================
// useSshPassword — Mutation hook for changing the SSH root password
// =============================================================================
// Posts to /cgi-bin/quecmanager/system/ssh_password.sh. Resolves to a result
// object rather than a bare boolean, so the caller toasts the device's reason
// from the returned value and never from hook state read after an `await`.
// `verifyPassword` is the Passwords card's Continue step: the same endpoint in
// `verify_only` mode, which checks the current password and changes nothing.
// The QManager web session is NOT affected by a successful change.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/ssh_password.sh";

export type ChangeSshPasswordResult = PasswordActionResult;
export type UseSshPasswordReturn = PasswordActions;

export function useSshPassword(): UseSshPasswordReturn {
  const { t } = useTranslation("errors");
  const [isPending, setIsPending] = useState(false);

  const post = useCallback(
    async (
      body: SshPasswordChangeRequest | SshPasswordVerifyRequest,
    ): Promise<PasswordActionResult> => {
      setIsPending(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!resp.ok && resp.status !== 400 && resp.status !== 401) {
          return { success: false };
        }

        const data = (await resp.json()) as SshPasswordChangeResponse;

        if (!data.success) {
          const message = resolveErrorMessage(t, data.error, data.detail, "");
          return { success: false, message: message || undefined };
        }

        return { success: true };
      } catch {
        return { success: false };
      } finally {
        setIsPending(false);
      }
    },
    [t],
  );

  const changePassword = useCallback(
    (
      currentPassword: string,
      newPassword: string,
      enforceStrong: boolean,
    ) =>
      post({
        current_password: currentPassword,
        new_password: newPassword,
        enforce_strong: enforceStrong,
      }),
    [post],
  );

  const verifyPassword = useCallback(
    (currentPassword: string) =>
      post({ current_password: currentPassword, verify_only: true }),
    [post],
  );

  return { changePassword, verifyPassword, isPending };
}
