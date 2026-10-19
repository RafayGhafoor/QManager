import type { TFunction } from "i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

// =============================================================================
// postStep — one wizard write, read honestly
// =============================================================================
// Every failure path in cgi_base.sh emits {"success":false,"error":…,"detail":…}
// with no Status: header, so the web server answers 200 and `resp.ok` cannot
// see a modem error. `.success` is the only honest signal (RM520N fork
// 578ddb2f found the band-lock step discarding exactly this). Never throws.
// =============================================================================

export interface StepWriteResult {
  ok: boolean;
  /** Backend error code, for resolveErrorMessage. */
  error?: string;
  /** Backend detail, or a transport failure marker. */
  detail?: string;
  /** True when the request never reached the modem. */
  unreachable?: boolean;
}

interface Envelope {
  success?: boolean;
  error?: string;
  detail?: string;
}

export async function postStep(endpoint: string, body: unknown): Promise<StepWriteResult> {
  let response: Response;
  try {
    response = await authFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, unreachable: true };
  }

  let data: Envelope | null = null;
  try {
    data = (await response.json()) as Envelope;
  } catch {
    data = null;
  }

  // settings.sh reports a partial apply as success:false with failed_fields;
  // the step treats that as a failure too, since part of the choice did not land.
  if (response.ok && data?.success === true) return { ok: true };
  return {
    ok: false,
    error: data?.error || undefined,
    detail: data?.detail || (response.ok ? undefined : `HTTP ${response.status}`),
  };
}

/**
 * The one-sentence reason for a failed write: a known backend code through
 * resolveErrorMessage, else the detail, else the step's own fallback.
 * `t` is the onboarding-namespace translator.
 */
export function stepFailureMessage(t: TFunction, result: StepWriteResult, fallback: string): string {
  if (result.unreachable) return t("shell.error_unreachable");
  return resolveErrorMessage(t, result.error, result.detail, fallback);
}
