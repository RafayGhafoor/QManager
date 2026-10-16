// lib/i18n/language-pack-client.ts
import { authFetch } from "@/lib/auth-fetch";
import type {
  LanguageCode,
  LanguagePackInstallState,
  LanguagePackInstallStep,
  RemoteManifest,
} from "@/types/i18n";
import { parseManifest } from "./language-pack-manifest";

const CGI_BASE = "/cgi-bin/quecmanager/system/language-packs";

export interface InstalledPack {
  code: LanguageCode;
  version: string;
}

export interface MutationResult {
  ok: boolean;
  error?: string;
}

export interface LanguagePackListResponse {
  installed: InstalledPack[];
  manifest: RemoteManifest | null;
  manifest_error: string | null;
}

export async function fetchLanguagePackList(
  manifestUrl: string,
): Promise<LanguagePackListResponse> {
  const url = `${CGI_BASE}/list.sh?manifest_url=${encodeURIComponent(manifestUrl)}`;
  const resp = await authFetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
  const raw = await resp.json();
  const installed: InstalledPack[] = Array.isArray(raw.installed) ? raw.installed : [];
  let manifest: RemoteManifest | null = null;
  if (raw.manifest && !raw.manifest_error) {
    const parsed = parseManifest(raw.manifest);
    if (parsed.ok) manifest = parsed.manifest;
  }
  const manifestError: string | null =
    typeof raw.manifest_error === "string" ? raw.manifest_error : null;
  return { installed, manifest, manifest_error: manifestError };
}

export async function startLanguagePackInstall(
  code: LanguageCode,
  manifestUrl: string,
): Promise<MutationResult> {
  const resp = await authFetch(`${CGI_BASE}/install.sh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, manifest_url: manifestUrl }),
  });
  if (resp.status === 409) {
    return { ok: false, error: "install_in_progress" };
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    return { ok: false, error: body.error || `http_${resp.status}` };
  }
  return { ok: true };
}

// The worker (`lp_write_progress`) reports `state` idle|running|success|failed|
// cancelled and, while running, a `step`. The UI speaks one state per step, so
// the two are folded together here and nowhere else.
const RUNNING_STEP_STATE: Record<string, LanguagePackInstallStep> = {
  start: "pending",
  fetch_catalog: "pending",
  download: "downloading",
  verify: "verifying",
  extract: "extracting",
  validate: "validating",
  install: "installing",
};

export function normalizeInstallStatus(raw: unknown): LanguagePackInstallState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawState = typeof r.state === "string" ? r.state : "idle";
  const rawStep = typeof r.step === "string" ? r.step : "";
  const message = typeof r.message === "string" && r.message ? r.message : undefined;
  const base = {
    code: typeof r.code === "string" && r.code ? r.code : undefined,
    progress: typeof r.progress === "number" ? r.progress : 0,
    message,
  };

  switch (rawState) {
    case "running": {
      const state = RUNNING_STEP_STATE[rawStep] ?? "pending";
      return { ...base, state, step: state };
    }
    case "success":
      return { ...base, state: "done", step: "done", progress: 100 };
    case "failed":
      return {
        ...base,
        state: "failed",
        step: "failed",
        error_code:
          typeof r.error === "string" && r.error
            ? r.error
            : typeof r.error_code === "string" && r.error_code
              ? r.error_code
              : undefined,
      };
    case "cancelled":
      return { ...base, state: "cancelled", step: "cancelled" };
    default:
      return { ...base, state: "idle" };
  }
}

export async function getLanguagePackInstallStatus(): Promise<LanguagePackInstallState> {
  const resp = await authFetch(`${CGI_BASE}/install_status.sh`);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
  return normalizeInstallStatus(await resp.json());
}

export async function cancelLanguagePackInstall(): Promise<void> {
  const resp = await authFetch(`${CGI_BASE}/install_cancel.sh`, { method: "POST" });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
}

export async function removeLanguagePack(
  code: LanguageCode,
): Promise<MutationResult> {
  const resp = await authFetch(`${CGI_BASE}/remove.sh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    return { ok: false, error: body.error || `http_${resp.status}` };
  }
  return { ok: true };
}
