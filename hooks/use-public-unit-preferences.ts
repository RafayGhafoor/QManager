"use client";

import { useEffect, useState } from "react";

// =============================================================================
// usePublicUnitPreferences — Pre-auth unit preferences for the "/" splash.
// =============================================================================
// Returns the SAME shape as useUnitPreferences (hooks/use-system-settings.ts)
// so the splash formats temperature identically to the dashboard.
//
// WHY a separate hook: useUnitPreferences reads the authenticated
// system/settings.sh, which 401s for a signed-out visitor, so the splash fell
// back to celsius. This variant reads the unauthenticated public/units.sh
// with `credentials: "omit"` (the pre-auth surface never sends cookies it
// does not need) and never throws or redirects. Any failure resolves to
// `null`, and the consumer falls back to its own defaults.
// =============================================================================

const FETCH_ENDPOINT = "/cgi-bin/quecmanager/public/units.sh";

interface UnitPreferences {
  tempUnit: "celsius" | "fahrenheit";
  distanceUnit: "km" | "miles";
}

interface PublicUnitsResponse {
  settings?: {
    temp_unit?: string;
    distance_unit?: string;
  };
}

export function usePublicUnitPreferences(): UnitPreferences | null {
  const [prefs, setPrefs] = useState<UnitPreferences | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(FETCH_ENDPOINT, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: PublicUnitsResponse | null) => {
        const s = json?.settings;
        if (controller.signal.aborted || !s) return;
        setPrefs({
          tempUnit: s.temp_unit === "fahrenheit" ? "fahrenheit" : "celsius",
          distanceUnit: s.distance_unit === "miles" ? "miles" : "km",
        });
      })
      .catch(() => {
        // Silent: fall back to the consumer's defaults on any error.
      });

    return () => controller.abort();
  }, []);

  return prefs;
}
