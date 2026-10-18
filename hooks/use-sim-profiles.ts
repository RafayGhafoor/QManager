"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import i18next from "i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  SimProfile,
  ProfileSummary,
  ProfileListResponse,
  ProfileApiResponse,
  ProfileScenarioBinding,
} from "@/types/sim-profile";

// =============================================================================
// useSimProfiles — CRUD Hook for QManager Custom SIM Profiles
// =============================================================================
// Manages the full profile lifecycle: list, create, update, delete.
// Reads from /cgi-bin/quecmanager/profiles/ endpoints.
//
// No modem interaction — all operations read/write flash only.
// Apply operations are handled by the separate useProfileApply hook.
//
// Usage:
//   const {
//     profiles, activeProfileId, isLoading, error,
//     createProfile, updateProfile, deleteProfile, refresh
//   } = useSimProfiles();
// =============================================================================

const CGI_BASE = "/cgi-bin/quecmanager/profiles";

/** Mutation outcomes; `error` is already translated and safe to toast. */
export type ProfileActionResult = { ok: true } | { ok: false; error: string };
export type ProfileCreateResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };
export type ProfileDeactivateResult =
  | { ok: true; requiresReboot: boolean }
  | { ok: false; error: string };

/** Translate a `cellular` key outside React (the hook has no `t`). */
const tr = (key: string) => i18next.t(key, { ns: "cellular" });

export interface UseSimProfilesReturn {
  /** Array of profile summaries (for list view) */
  profiles: ProfileSummary[];
  /** Currently active profile ID, or null */
  activeProfileId: string | null;
  /** True during initial fetch */
  isLoading: boolean;
  /** Error message from the last operation */
  error: string | null;
  /** Create a new profile. Returns the new profile ID on success. */
  createProfile: (data: ProfileFormData) => Promise<ProfileCreateResult>;
  /** Update an existing profile. Returns success boolean. */
  updateProfile: (id: string, data: ProfileFormData) => Promise<ProfileActionResult>;
  /** Delete a profile by ID. Returns success boolean. */
  deleteProfile: (id: string) => Promise<ProfileActionResult>;
  /** Fetch a single profile by ID (full data for edit form). */
  getProfile: (id: string) => Promise<SimProfile | null>;
  /** Deactivate the current active profile (clears marker only, no modem changes). */
  deactivateProfile: () => Promise<ProfileDeactivateResult>;
  /** Manually refresh the profile list */
  refresh: () => void;
}

/**
 * Flat form data shape that the backend save.sh endpoint expects.
 * This matches the jq field keys in profile_mgr.sh's profile_save().
 */
export interface ProfileFormData {
  name: string;
  mno: string;
  sim_iccid: string;
  /** APN context ID (1-15) */
  cid: number;
  /** APN name */
  apn_name: string;
  pdp_type: string;
  imei: string;
  ttl: number;
  hl: number;
  /**
   * Connection-scenario binding (nested object the backend save.sh accepts).
   * Always sent — defaults to {@link DEFAULT_SCENARIO_BINDING} in the form.
   */
  scenario: ProfileScenarioBinding;
}

export function useSimProfiles(): UseSimProfilesReturn {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch profile list
  // ---------------------------------------------------------------------------
  const fetchProfiles = useCallback(async () => {
    try {
      const resp = await authFetch(`${CGI_BASE}/list.sh`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: ProfileListResponse = await resp.json();
      if (!mountedRef.current) return;

      setProfiles(data.profiles || []);
      setActiveProfileId(data.active_profile_id || null);
      setError(null);
    } catch {
      if (!mountedRef.current) return;
      setError(tr("custom_profiles.errors.load_failed"));
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  // ---------------------------------------------------------------------------
  // Shared POST: resolves to the parsed body, or a translated failure.
  // ---------------------------------------------------------------------------
  const post = useCallback(
    async (
      endpoint: string,
      body: unknown,
      fallbackKey: string,
    ): Promise<
      | { ok: true; result: ProfileApiResponse & { requires_reboot?: boolean } }
      | { ok: false; error: string }
    > => {
      const fallback = tr(fallbackKey);
      try {
        const resp = await authFetch(`${CGI_BASE}/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const result: ProfileApiResponse & { requires_reboot?: boolean } =
          await resp.json();
        if (!result.success) {
          return {
            ok: false,
            error: resolveErrorMessage(
              i18next.t.bind(i18next),
              result.error,
              result.detail,
              fallback,
            ),
          };
        }
        return { ok: true, result };
      } catch {
        return { ok: false, error: fallback };
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Create profile
  // ---------------------------------------------------------------------------
  const createProfile = useCallback(
    async (data: ProfileFormData): Promise<ProfileCreateResult> => {
      const r = await post("save.sh", data, "custom_profiles.errors.save_failed");
      if (!r.ok) return r;
      await fetchProfiles();
      return { ok: true, id: r.result.id || null };
    },
    [fetchProfiles, post],
  );

  // ---------------------------------------------------------------------------
  // Update profile (the existing id tells profile_save() it is an update)
  // ---------------------------------------------------------------------------
  const updateProfile = useCallback(
    async (id: string, data: ProfileFormData): Promise<ProfileActionResult> => {
      const r = await post(
        "save.sh",
        { ...data, id },
        "custom_profiles.errors.save_failed",
      );
      if (!r.ok) return r;
      await fetchProfiles();
      return { ok: true };
    },
    [fetchProfiles, post],
  );

  // ---------------------------------------------------------------------------
  // Delete profile
  // ---------------------------------------------------------------------------
  const deleteProfile = useCallback(
    async (id: string): Promise<ProfileActionResult> => {
      const r = await post(
        "delete.sh",
        { id },
        "custom_profiles.errors.delete_failed",
      );
      if (!r.ok) return r;
      await fetchProfiles();
      return { ok: true };
    },
    [fetchProfiles, post],
  );

  // ---------------------------------------------------------------------------
  // Deactivate active profile
  // ---------------------------------------------------------------------------
  const deactivateProfile = useCallback(async (): Promise<ProfileDeactivateResult> => {
    const r = await post(
      "deactivate.sh",
      undefined,
      "custom_profiles.errors.deactivate_failed",
    );
    if (!r.ok) return r;
    await fetchProfiles();
    return { ok: true, requiresReboot: r.result.requires_reboot === true };
  }, [fetchProfiles, post]);

  // ---------------------------------------------------------------------------
  // Get single profile (for edit form)
  // ---------------------------------------------------------------------------
  const getProfile = useCallback(
    async (id: string): Promise<SimProfile | null> => {
      try {
        const resp = await authFetch(`${CGI_BASE}/get.sh?id=${encodeURIComponent(id)}`);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data = await resp.json();

        // The get endpoint returns the full profile on success,
        // or { success: false, error: "..." } on failure.
        if (data.success === false) return null;

        return data as SimProfile;
      } catch {
        return null;
      }
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Manual refresh
  // ---------------------------------------------------------------------------
  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchProfiles();
  }, [fetchProfiles]);

  return {
    profiles,
    activeProfileId,
    isLoading,
    error,
    createProfile,
    updateProfile,
    deleteProfile,
    deactivateProfile,
    getProfile,
    refresh,
  };
}
