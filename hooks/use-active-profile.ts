"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { ProfileSummary, ProfileListResponse } from "@/types/sim-profile";
import { useSharedSimProfiles } from "@/hooks/use-sim-profiles";
import {
  resolveScheduledScenario,
  nextChangeAt as computeNextChangeAt,
} from "@/lib/scenario-schedule";

const CGI_BASE = "/cgi-bin/quecmanager/profiles";
const POLL_INTERVAL_MS = 30_000;
// Recompute the resolved/next-change scenario every minute so the locked badge
// advances at block boundaries without a network round-trip.
const TICK_INTERVAL_MS = 60_000;

export interface UseActiveProfileReturn {
  activeProfile: ProfileSummary | null;
  isVerizonActive: boolean;
  isLoading: boolean;
  refresh: () => void;
  // --- Scenario schedule lock (display-only; device cron is authoritative) ---
  /** True when the active profile has scenario.schedule.enabled. */
  scheduleLocked: boolean;
  /** Scenario id dictated by the schedule right now (or the default fallback). */
  scheduledScenarioId: string | null;
  /** "HH:MM" of the next scheduled transition, or null. */
  nextChangeAt: string | null;
  /** Active profile name, for the lock hint copy. */
  lockProfileName: string | null;
}

export function useActiveProfile(): UseActiveProfileReturn {
  // Under a SimProfilesProvider the shared list is the source and this hook
  // neither fetches nor polls (it keeps only its own clock tick).
  const shared = useSharedSimProfiles();
  const enabled = shared === null;
  const [ownProfile, setActiveProfile] = useState<ProfileSummary | null>(null);
  const [ownLoading, setIsLoading] = useState(true);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchActive = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const resp = await authFetch(`${CGI_BASE}/list.sh`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data: ProfileListResponse = await resp.json();
      if (!mountedRef.current) return;

      const active = data.active_profile_id
        ? (data.profiles ?? []).find((p) => p.id === data.active_profile_id) ?? null
        : null;

      setActiveProfile(active);
    } catch {
      // keep stale data on error
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetchActive();
    const id = setInterval(fetchActive, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, fetchActive]);

  const sharedProfiles = shared?.profiles;
  const sharedActiveId = shared?.activeProfileId ?? null;
  const activeProfile = useMemo<ProfileSummary | null>(() => {
    if (!sharedProfiles) return ownProfile;
    if (!sharedActiveId) return null;
    return sharedProfiles.find((p) => p.id === sharedActiveId) ?? null;
  }, [sharedProfiles, sharedActiveId, ownProfile]);

  // Minute tick to advance the scheduled-scenario resolution at block edges.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const binding = activeProfile?.scenario ?? null;
  const scheduleLocked = !!binding?.schedule.enabled;

  const scheduledScenarioId = useMemo(() => {
    if (!binding || !scheduleLocked) return null;
    return resolveScheduledScenario(now, binding.schedule, binding.default);
  }, [binding, scheduleLocked, now]);

  const nextChangeAt = useMemo(() => {
    if (!binding || !scheduleLocked) return null;
    return computeNextChangeAt(now, binding.schedule, binding.default);
  }, [binding, scheduleLocked, now]);

  return {
    activeProfile,
    isVerizonActive: activeProfile?.mno === "Verizon",
    isLoading: shared ? shared.isLoading : ownLoading,
    refresh: shared ? shared.refresh : fetchActive,
    scheduleLocked,
    scheduledScenarioId,
    nextChangeAt,
    lockProfileName: scheduleLocked ? activeProfile?.name ?? null : null,
  };
}
