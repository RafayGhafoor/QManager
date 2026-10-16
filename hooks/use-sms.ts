"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  SmsMessage,
  SmsStorage,
  SmsInboxResponse,
  SmsActionResponse,
} from "@/types/sms";

// =============================================================================
// useSms — SMS Inbox Fetch & Mutation Hook
// =============================================================================
// Fetches inbox messages + storage status on mount.
// Provides sendSms, deleteSms, deleteAllSms for mutations.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/cellular/sms.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/sms.sh";

const OK: SmsActionResult = { ok: true };
const fail = (error: string): SmsActionResult => ({ ok: false, error });

export interface SmsData {
  messages: SmsMessage[];
  storage: SmsStorage;
}

/** Mutation outcome: `error` is already translated and safe to toast. */
export type SmsActionResult = { ok: true } | { ok: false; error: string };

export interface UseSmsReturn {
  /** Current SMS data (null before first fetch) */
  data: SmsData | null;
  /** True while initial fetch is in progress */
  isLoading: boolean;
  /** True while a send/delete operation is in progress */
  isSaving: boolean;
  /** Error message if any operation failed */
  error: string | null;
  /** Send an SMS message. Resolves with the outcome. */
  sendSms: (phone: string, message: string) => Promise<SmsActionResult>;
  /** Delete a message by its storage indexes. Resolves with the outcome.
   *  `storage` selects which modem memory (ME / SM) the indexes live in;
   *  the backend deletes one storage per call. */
  deleteSms: (indexes: number[], storage: "ME" | "SM") => Promise<SmsActionResult>;
  /** Delete all messages. Resolves with the outcome. */
  deleteAllSms: () => Promise<SmsActionResult>;
  /** Re-fetch inbox data. Pass true for silent (no loading skeleton). */
  refresh: (silent?: boolean) => void;
}

export function useSms(): UseSmsReturn {
  const { t } = useTranslation("cellular");
  const [data, setData] = useState<SmsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch inbox messages + storage status
  // ---------------------------------------------------------------------------
  const fetchInbox = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json: SmsInboxResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(
          resolveErrorMessage(
            t,
            json.error,
            json.detail,
            t("sms.errors.fetch"),
          ),
        );
        return;
      }

      setData({
        messages: json.messages || [],
        storage: json.storage || { used: 0, total: 0 },
      });
    } catch {
      if (!mountedRef.current) return;
      setError(t("sms.errors.fetch"));
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, [t]);

  // Fetch on mount
  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  // ---------------------------------------------------------------------------
  // Send SMS
  // ---------------------------------------------------------------------------
  const sendSms = useCallback(
    async (phone: string, message: string): Promise<SmsActionResult> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send", phone, message }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json: SmsActionResponse = await resp.json();
        if (!mountedRef.current) return fail(t("sms.errors.send"));

        if (!json.success) {
          const msg = resolveErrorMessage(
            t,
            json.error,
            json.detail,
            t("sms.errors.send"),
          );
          setError(msg);
          return { ok: false, error: msg };
        }

        // Delayed silent re-fetch — modem needs a moment to process the sent message
        setTimeout(() => {
          if (mountedRef.current) fetchInbox(true);
        }, 1000);
        return OK;
      } catch {
        const msg = t("sms.errors.send");
        if (!mountedRef.current) return { ok: false, error: msg };
        setError(msg);
        return { ok: false, error: msg };
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchInbox, t]
  );

  // ---------------------------------------------------------------------------
  // Delete single message
  // ---------------------------------------------------------------------------
  const deleteSms = useCallback(
    async (indexes: number[], storage: "ME" | "SM"): Promise<SmsActionResult> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", indexes, storage }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json: SmsActionResponse = await resp.json();
        if (!mountedRef.current) return fail(t("sms.errors.delete"));

        if (!json.success) {
          const msg = resolveErrorMessage(
            t,
            json.error,
            json.detail,
            t("sms.errors.delete"),
          );
          setError(msg);
          return { ok: false, error: msg };
        }

        // Silent re-fetch to update inbox
        await fetchInbox(true);
        return OK;
      } catch {
        const msg = t("sms.errors.delete");
        if (!mountedRef.current) return { ok: false, error: msg };
        setError(msg);
        return { ok: false, error: msg };
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchInbox, t]
  );

  // ---------------------------------------------------------------------------
  // Delete all messages
  // ---------------------------------------------------------------------------
  const deleteAllSms = useCallback(async (): Promise<SmsActionResult> => {
    setError(null);
    setIsSaving(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_all" }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json: SmsActionResponse = await resp.json();
      if (!mountedRef.current) return fail(t("sms.errors.delete_all"));

      if (!json.success) {
        const msg = resolveErrorMessage(
          t,
          json.error,
          json.detail,
          t("sms.errors.delete_all"),
        );
        setError(msg);
        return { ok: false, error: msg };
      }

      // Silent re-fetch to update inbox
      await fetchInbox(true);
      return OK;
    } catch {
      const msg = t("sms.errors.delete_all");
      if (!mountedRef.current) return { ok: false, error: msg };
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  }, [fetchInbox, t]);

  return {
    data,
    isLoading,
    isSaving,
    error,
    sendSms,
    deleteSms,
    deleteAllSms,
    refresh: fetchInbox,
  };
}
