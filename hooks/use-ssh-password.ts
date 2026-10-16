"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  SshPasswordChangeRequest,
  SshPasswordChangeResponse,
} from "@/types/ssh-password";

// =============================================================================
// useSshPassword — Mutation hook for changing the SSH root password
// =============================================================================
// Posts to /cgi-bin/quecmanager/system/ssh_password.sh. Resolves to a result
// object rather than a bare boolean, so the caller toasts the device's reason
// from the returned value and never from hook state read after an `await`.
// The QManager web session is NOT affected by a successful change.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/ssh_password.sh";

export interface ChangeSshPasswordResult {
  success: boolean;
  /**
   * The reason, already translated (`resolveErrorMessage`). Absent on success
   * and when the failure carried no reason, so the caller shows its own line.
   */
  message?: string;
}

export interface UseSshPasswordReturn {
  changePassword: (
    currentPassword: string,
    newPassword: string,
    enforceStrong: boolean,
  ) => Promise<ChangeSshPasswordResult>;
  isPending: boolean;
}

export function useSshPassword(): UseSshPasswordReturn {
  const { t } = useTranslation("errors");
  const [isPending, setIsPending] = useState(false);

  const changePassword = useCallback(
    async (
      currentPassword: string,
      newPassword: string,
      enforceStrong: boolean,
    ): Promise<ChangeSshPasswordResult> => {
      setIsPending(true);

      try {
        const body: SshPasswordChangeRequest = {
          current_password: currentPassword,
          new_password: newPassword,
          enforce_strong: enforceStrong,
        };

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

  return { changePassword, isPending };
}
